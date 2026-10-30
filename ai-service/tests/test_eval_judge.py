import json
from collections.abc import Callable
from typing import Any

import anthropic
import httpx2
import pytest

from ai_service.eval_judge import (
    JUDGE_INSTRUCTIONS,
    JUDGE_MODEL,
    Judge,
    JudgeFailed,
    JudgeSource,
    build_judge_request,
    make_judge_client,
    seed_source_texts,
)
from ai_service.eval_sets import SeedPageEntry
from ai_service.leak_suite import SEED_EMAILS
from ai_service.settings import (
    AskSettings,
    DbSetupSettings,
    EvalSettings,
    IndexSettings,
    LeakSuiteSettings,
    MigrationSettings,
    RequestLogReportSettings,
    Settings,
    WorkerSettings,
)
from tests.conftest import BRIDGE_KEY, REQUEST_LOG_KEY, SERVICE_CREDENTIAL
from tests.seed_matrix import PAGES_DIR

JUDGE_KEY = "test-judge-key"
CONTENT_DIR = PAGES_DIR.parent
PAGES = [
    SeedPageEntry(
        "Allgemein", "Reisekosten Richtlinie 2022", "allgemein/reisekosten-richtlinie-2022.md", []
    ),
    SeedPageEntry(
        "Allgemein", "Reisekosten Richtlinie 2026", "allgemein/reisekosten-richtlinie-2026.md", []
    ),
    SeedPageEntry(
        "Vertrieb",
        "Kundenvertrag Stadtwerke Beispielstadt",
        "vertrieb/kundenvertrag-stadtwerke.md",
        ["kundenvertrag-stadtwerke-beispielstadt.pdf"],
    ),
]
PAGE_SOURCE = {"title": "Reisekosten Richtlinie 2026", "fileName": None}
PDF_SOURCE = {
    "title": "Kundenvertrag Stadtwerke Beispielstadt",
    "fileName": "kundenvertrag-stadtwerke-beispielstadt.pdf",
}
QUESTION = "Wie hoch ist die Kilometerpauschale?"
REFERENCE = "0,38 EUR pro Kilometer."
ANSWER = "Die Pauschale beträgt 0,38 EUR pro Kilometer [1]."
UNCITED_SENTENCE = "Hotelübernachtungen werden bis 110 € pro Nacht erstattet."
CITED_SENTENCE = "Hotelübernachtungen werden bis 140 € pro Nacht erstattet."
PDF_SENTENCE = "Werkvertrag Belebungsstufe"
FULL_VERDICT = {
    "grounded": True,
    "grounded_reason": "Alles steht in der Quelle.",
    "correct": True,
    "correct_reason": "Der Wert stimmt.",
}

Handler = Callable[[httpx2.Request], httpx2.Response]


def message_response(
    verdict: dict[str, Any], stop_reason: str = "end_turn", status: int = 200
) -> httpx2.Response:
    body = {
        "id": "msg_test",
        "type": "message",
        "role": "assistant",
        "model": JUDGE_MODEL,
        "content": [{"type": "text", "text": json.dumps(verdict)}],
        "stop_reason": stop_reason,
        "stop_sequence": None,
        "usage": {"input_tokens": 10, "output_tokens": 10},
    }
    return httpx2.Response(status, json=body)


class Recorder:
    def __init__(self, respond: Handler) -> None:
        self.requests: list[httpx2.Request] = []
        self.respond = respond

    def __call__(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        return self.respond(request)

    def body(self) -> dict[str, Any]:
        return json.loads(self.requests[0].content)


def judge_with(respond: Handler) -> tuple[Judge, Recorder]:
    recorder = Recorder(respond)
    client = make_judge_client(
        JUDGE_KEY, http_client=httpx2.Client(transport=httpx2.MockTransport(recorder))
    )
    return Judge(client), recorder


def judge_sources() -> list[JudgeSource]:
    return seed_source_texts([PAGE_SOURCE, PDF_SOURCE], PAGES, CONTENT_DIR)


def test_eval_ac15_request_holds_the_inputs_and_the_seed_text_of_page_and_pdf():
    judge, recorder = judge_with(lambda request: message_response(FULL_VERDICT))
    judge.rate(QUESTION, REFERENCE, ANSWER, judge_sources())
    body = recorder.body()
    text = json.dumps(body, ensure_ascii=False)
    assert body["system"] == JUDGE_INSTRUCTIONS
    assert body["model"] == JUDGE_MODEL
    for part in (QUESTION, REFERENCE, ANSWER, CITED_SENTENCE, PDF_SENTENCE):
        assert part in text


def test_eval_ac15_request_holds_no_login_password_token_user_id_or_other_page():
    judge, recorder = judge_with(lambda request: message_response(FULL_VERDICT))
    judge.rate(QUESTION, REFERENCE, ANSWER, judge_sources())
    text = json.dumps(recorder.body(), ensure_ascii=False)
    for email in SEED_EMAILS.values():
        assert email not in text
    for secret in ("seed-demo-password", BRIDGE_KEY, SERVICE_CREDENTIAL, JUDGE_KEY):
        assert secret not in text
    assert UNCITED_SENTENCE not in text
    assert set(recorder.body()) == {"model", "max_tokens", "system", "messages", "output_config"}


def test_eval_ac15_a_source_is_sent_once_even_when_cited_twice():
    sources = seed_source_texts(
        [PAGE_SOURCE, PDF_SOURCE, PAGE_SOURCE, PDF_SOURCE], PAGES, CONTENT_DIR
    )
    assert [source.title for source in sources] == [
        "Reisekosten Richtlinie 2026",
        "kundenvertrag-stadtwerke-beispielstadt.pdf",
    ]


def test_eval_ac15_a_page_and_its_pdf_are_two_sources():
    sources = seed_source_texts(
        [{"title": PDF_SOURCE["title"], "fileName": None}, PDF_SOURCE], PAGES, CONTENT_DIR
    )
    assert len(sources) == 2
    assert PDF_SENTENCE not in sources[0].text
    assert PDF_SENTENCE in sources[1].text


def test_eval_ac15_a_source_title_that_is_no_seed_title_fails_without_a_request():
    judge, recorder = judge_with(lambda request: message_response(FULL_VERDICT))
    with pytest.raises(JudgeFailed) as raised:
        seed_source_texts([{"title": "Leak-Test Injektion", "fileName": None}], PAGES, CONTENT_DIR)
    assert raised.value.error_class == "non_seed_source"
    assert judge is not None
    assert recorder.requests == []


def test_eval_ac15_the_request_message_delimits_each_input():
    messages = build_judge_request(QUESTION, REFERENCE, ANSWER, judge_sources())
    assert [message["role"] for message in messages] == ["user"]
    content = messages[0]["content"]
    assert content.index(QUESTION) < content.index(REFERENCE) < content.index(ANSWER)
    assert content.index("SOURCE TEXT: Reisekosten Richtlinie 2026") < content.index(ANSWER)
    assert content.index("SOURCE TEXT: kundenvertrag-stadtwerke-beispielstadt.pdf") < content.index(
        ANSWER
    )


def test_eval_ac15_instructions_name_the_rating_rules():
    for part in ("grounded", "correct", "reference", "data"):
        assert part in JUDGE_INSTRUCTIONS


def test_eval_ac13_without_a_reference_only_grounded_is_asked_and_correct_is_none():
    verdict = {"grounded": False, "grounded_reason": "Zahl fehlt in der Quelle."}
    judge, recorder = judge_with(lambda request: message_response(verdict))
    ratings = judge.rate(QUESTION, None, ANSWER, judge_sources())
    schema = recorder.body()["output_config"]["format"]["schema"]
    assert set(schema["properties"]) == {"grounded", "grounded_reason"}
    assert "Reference" not in json.dumps(recorder.body()["messages"])
    assert ratings.grounded is False
    assert ratings.grounded_reason == "Zahl fehlt in der Quelle."
    assert ratings.correct is None
    assert ratings.correct_reason is None


def test_eval_ac13_with_a_reference_both_ratings_are_asked_and_returned():
    judge, recorder = judge_with(lambda request: message_response(FULL_VERDICT))
    ratings = judge.rate(QUESTION, REFERENCE, ANSWER, judge_sources())
    schema = recorder.body()["output_config"]["format"]["schema"]
    assert set(schema["properties"]) == set(FULL_VERDICT)
    assert ratings.correct is True
    assert ratings.correct_reason == "Der Wert stimmt."


def test_eval_ac17_the_key_is_only_in_the_authorization_header():
    judge, recorder = judge_with(lambda request: message_response(FULL_VERDICT))
    judge.rate(QUESTION, REFERENCE, ANSWER, judge_sources())
    request = recorder.requests[0]
    assert request.headers["authorization"] == f"Bearer {JUDGE_KEY}"
    assert JUDGE_KEY.encode() not in request.content
    assert JUDGE_KEY not in str(request.url)
    assert str(request.url) == "https://api.anthropic.com/v1/messages"
    others = {k: v for k, v in request.headers.items() if k.lower() != "authorization"}
    assert all(JUDGE_KEY not in value for value in others.values())


def test_eval_ac17_the_client_does_not_read_the_key_from_the_environment(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-ambient-key")
    judge, recorder = judge_with(lambda request: message_response(FULL_VERDICT))
    judge.rate(QUESTION, REFERENCE, ANSWER, judge_sources())
    assert recorder.requests[0].headers["authorization"] == f"Bearer {JUDGE_KEY}"


def test_eval_ac18_no_ai_service_settings_class_holds_the_judge_key(
    monkeypatch: pytest.MonkeyPatch,
):
    environment = {
        "EVAL_ANTHROPIC_API_KEY": JUDGE_KEY,
        "AI_BRIDGE_SECRET": BRIDGE_KEY,
        "AI_SERVICE_TOKEN": SERVICE_CREDENTIAL,
        "AI_REQUEST_LOG_SECRET": REQUEST_LOG_KEY,
        "REDIS_URL": "redis://127.0.0.1:6380/15",
        "AI_DATABASE_URL": "postgresql://docmost_ai:test-pw@127.0.0.1:5433/docmost",
        "AI_DB_ADMIN_URL": "postgresql://admin:test-pw@127.0.0.1:5433/docmost",
        "AI_WIKI_URL": "http://127.0.0.1:3000",
        "LEAK_WIKI_URL": "http://127.0.0.1:3000",
        "EVAL_WIKI_URL": "http://127.0.0.1:3000",
    }
    for name, value in environment.items():
        monkeypatch.setenv(name, value)
    classes = (
        Settings,
        IndexSettings,
        WorkerSettings,
        AskSettings,
        MigrationSettings,
        LeakSuiteSettings,
        RequestLogReportSettings,
        DbSetupSettings,
    )
    for settings_class in classes:
        instance = settings_class(_env_file=None)  # pyright: ignore[reportCallIssue]
        assert JUDGE_KEY not in repr(instance.model_dump())
        assert not any("anthropic" in name for name in settings_class.model_fields)
    judge_settings = EvalSettings(_env_file=None)  # pyright: ignore[reportCallIssue]
    assert judge_settings.eval_anthropic_api_key is not None
    assert judge_settings.eval_anthropic_api_key.get_secret_value() == JUDGE_KEY
    assert JUDGE_KEY not in repr(judge_settings)


def test_eval_ac55_an_overloaded_api_is_a_failed_judgement_with_its_class():
    error = {"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}}
    judge, recorder = judge_with(lambda request: httpx2.Response(529, json=error))
    with pytest.raises(JudgeFailed) as raised:
        judge.rate(QUESTION, REFERENCE, ANSWER, judge_sources())
    assert raised.value.error_class == "overloaded_error"
    assert len(recorder.requests) == 1


def test_eval_ac55_a_status_error_without_a_typed_body_names_the_exception_class():
    judge, _ = judge_with(lambda request: httpx2.Response(500, text="broken"))
    with pytest.raises(JudgeFailed) as raised:
        judge.rate(QUESTION, REFERENCE, ANSWER, judge_sources())
    assert raised.value.error_class == "InternalServerError"


def test_eval_ac55_an_unreachable_api_is_a_failed_judgement():
    def refuse(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("refused", request=request)

    judge, recorder = judge_with(refuse)
    with pytest.raises(JudgeFailed) as raised:
        judge.rate(QUESTION, REFERENCE, ANSWER, judge_sources())
    assert raised.value.error_class == "APIConnectionError"
    assert len(recorder.requests) == 1


def test_eval_ac56_a_timeout_is_a_failed_judgement_and_is_not_retried():
    def stall(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ReadTimeout("no answer", request=request)

    judge, recorder = judge_with(stall)
    with pytest.raises(JudgeFailed) as raised:
        judge.rate(QUESTION, REFERENCE, ANSWER, judge_sources())
    assert raised.value.error_class == "APITimeoutError"
    assert len(recorder.requests) == 1


def test_eval_ac56_the_client_waits_60_seconds_and_never_retries():
    client = make_judge_client(JUDGE_KEY)
    assert client.max_retries == 0
    assert client.timeout == 60.0
    assert isinstance(client, anthropic.Anthropic)


def test_eval_ac57_an_answer_without_grounded_is_a_failed_judgement():
    verdict = {"grounded_reason": "Fehlt."}
    judge, _ = judge_with(lambda request: message_response(verdict))
    with pytest.raises(JudgeFailed) as raised:
        judge.rate(QUESTION, None, ANSWER, judge_sources())
    assert raised.value.error_class == "invalid_verdict"


def test_eval_ac57_an_answer_without_correct_when_asked_is_a_failed_judgement():
    verdict = {"grounded": True, "grounded_reason": "Ja."}
    judge, _ = judge_with(lambda request: message_response(verdict))
    with pytest.raises(JudgeFailed) as raised:
        judge.rate(QUESTION, REFERENCE, ANSWER, judge_sources())
    assert raised.value.error_class == "invalid_verdict"


def test_eval_ac57_an_empty_reason_is_a_failed_judgement():
    verdict = {**FULL_VERDICT, "correct_reason": ""}
    judge, _ = judge_with(lambda request: message_response(verdict))
    with pytest.raises(JudgeFailed) as raised:
        judge.rate(QUESTION, REFERENCE, ANSWER, judge_sources())
    assert raised.value.error_class == "invalid_verdict"


def test_eval_ac57_text_that_is_no_json_is_a_failed_judgement():
    judge, _ = judge_with(
        lambda request: httpx2.Response(
            200,
            json={
                "id": "msg_test",
                "type": "message",
                "role": "assistant",
                "model": JUDGE_MODEL,
                "content": [{"type": "text", "text": "kein JSON"}],
                "stop_reason": "end_turn",
                "stop_sequence": None,
                "usage": {"input_tokens": 1, "output_tokens": 1},
            },
        )
    )
    with pytest.raises(JudgeFailed) as raised:
        judge.rate(QUESTION, REFERENCE, ANSWER, judge_sources())
    assert raised.value.error_class == "invalid_verdict"


def test_eval_ac57_a_refusal_is_a_failed_judgement():
    judge, _ = judge_with(lambda request: message_response(FULL_VERDICT, stop_reason="refusal"))
    with pytest.raises(JudgeFailed) as raised:
        judge.rate(QUESTION, REFERENCE, ANSWER, judge_sources())
    assert raised.value.error_class == "refusal"
