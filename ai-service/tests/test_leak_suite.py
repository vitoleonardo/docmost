import json
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

import httpx
import pytest
from pydantic import ValidationError

from ai_service.leak_suite import SEED_EMAILS, run
from ai_service.settings import AskSettings, LeakSuiteSettings

WIKI_URL = "http://wiki.test"
UMSTRUKTURIERUNG = "Umstrukturierung"
ANGEBOT = "Angebot"
UMSTRUKTURIERUNG_CANARY = "CANARY-AAAA0001"
ANGEBOT_CANARY = "CANARY-BBBB0002"
INJECTION_A = "Leak-Test Injektion A"
INJECTION_B = "Leak-Test Injektion B"
LEFTOVER = "Leak-Test Injektion Alt"
FRAGE_VERBATIM = "Frage verbatim Umstrukturierung"
FRAGE_PARAPHRASE = "Frage paraphrase Umstrukturierung"
ANGEBOT_VERBATIM = "Frage verbatim Angebot"
ANGEBOT_PARAPHRASE = "Frage paraphrase Angebot"
INJECTION_A_QUESTION = "Frage Injektion A"
INJECTION_B_QUESTION = "Frage Injektion B"
TOTAL_QUESTIONS = 16
PREVIOUS_REPORT = "previous report\n"

CANARIES = [
    {
        "canary": UMSTRUKTURIERUNG_CANARY,
        "space": "Allgemein",
        "title": UMSTRUKTURIERUNG,
        "deniedUsers": ["PL", "VT"],
    },
    {
        "canary": ANGEBOT_CANARY,
        "space": "Projekte",
        "title": ANGEBOT,
        "deniedUsers": ["VT"],
    },
]
QUESTIONS = [
    {"pageTitle": UMSTRUKTURIERUNG, "kind": "verbatim", "question": FRAGE_VERBATIM},
    {"pageTitle": UMSTRUKTURIERUNG, "kind": "paraphrase", "question": FRAGE_PARAPHRASE},
    {"pageTitle": ANGEBOT, "kind": "verbatim", "question": ANGEBOT_VERBATIM},
    {"pageTitle": ANGEBOT, "kind": "paraphrase", "question": ANGEBOT_PARAPHRASE},
    {"pageTitle": INJECTION_A, "kind": "verbatim", "question": INJECTION_A_QUESTION},
    {"pageTitle": INJECTION_B, "kind": "verbatim", "question": INJECTION_B_QUESTION},
]
INJECTION_PAGES = [
    {"title": INJECTION_A, "markdown": "# A\n\nText A"},
    {"title": INJECTION_B, "markdown": "# B\n\nText B"},
]
SEEDED_PAGES = {
    "page-umstrukturierung": (UMSTRUKTURIERUNG, "space-allgemein"),
    "page-willkommen": ("Willkommen", "space-allgemein"),
    "page-angebot": (ANGEBOT, "space-projekte"),
}
SPACES = {"space-allgemein": "Allgemein", "space-projekte": "Projekte"}

Events = list[dict[str, Any]]
Script = Callable[[str, str, int], Events | httpx.Response | None]


def sources_event(title: str, page_id: str, /, **extra: Any) -> dict[str, Any]:
    source = {
        "number": 1,
        "pageId": page_id,
        "title": title,
        "spaceName": "Allgemein",
        "headingPath": [],
        "fileName": None,
        "pdfPage": None,
        "url": "/p/x",
    }
    return {"type": "sources", "sources": [source | extra]}


def sse(events: Events) -> httpx.Response:
    body = "".join(f"data: {json.dumps(event)}\n\n" for event in events)
    return httpx.Response(200, content=body.encode(), headers={"content-type": "text/event-stream"})


@dataclass
class FakeWiki:
    script: Script | None = None
    login_failures: dict[str, int] = field(default_factory=dict)
    login_status: dict[str, int] = field(default_factory=dict)
    unreachable: bool = False
    missing_titles: tuple[str, ...] = ()
    leftovers: tuple[str, ...] = ()
    pages: dict[str, tuple[str, str]] = field(default_factory=dict)
    calls: list[tuple[str, str, dict[str, Any]]] = field(default_factory=list)
    asks: list[tuple[str, str]] = field(default_factory=list)
    conversation_ids: list[str] = field(default_factory=list)
    deleted: list[tuple[str, bool]] = field(default_factory=list)
    created_titles: list[str] = field(default_factory=list)
    ask_count: dict[tuple[str, str], int] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.pages = {
            page_id: value
            for page_id, value in SEEDED_PAGES.items()
            if value[0] not in self.missing_titles
        }
        for index, title in enumerate(self.leftovers):
            self.pages[f"page-leftover-{index}"] = (title, "space-allgemein")
        self.question_titles = {item["question"]: item["pageTitle"] for item in QUESTIONS}
        self.logins: dict[str, int] = {}

    def client(self) -> httpx.Client:
        return httpx.Client(base_url=WIKI_URL, transport=httpx.MockTransport(self.handle))

    def handle(self, request: httpx.Request) -> httpx.Response:
        if self.unreachable:
            raise httpx.ConnectError("refused", request=request)
        body = json.loads(request.content) if request.content else {}
        cookie = request.headers.get("cookie", "")
        user = cookie.removeprefix("authToken=") if cookie else ""
        self.calls.append((request.url.path, user, body))
        path = request.url.path
        if path == "/api/auth/login":
            return self.login(body)
        if path == "/api/spaces":
            items = [{"id": key, "name": name} for key, name in SPACES.items()]
            return httpx.Response(200, json={"data": {"items": items}})
        if path == "/api/pages/recent":
            return self.recent(body)
        if path == "/api/pages/create":
            return self.create(body)
        if path == "/api/pages/delete":
            self.deleted.append((body["pageId"], bool(body.get("permanentlyDelete"))))
            self.pages.pop(body["pageId"], None)
            return httpx.Response(200, json={"data": {}})
        if path == "/api/ai/ask":
            return self.ask(user, body)
        return httpx.Response(404)

    def login(self, body: dict[str, Any]) -> httpx.Response:
        [key] = [name for name, email in SEED_EMAILS.items() if email == body["email"]]
        attempts = self.logins.get(key, 0)
        self.logins[key] = attempts + 1
        if attempts < self.login_failures.get(key, 0):
            return httpx.Response(self.login_status.get(key, 401))
        return httpx.Response(200, headers={"set-cookie": f"authToken={key}; Path=/"})

    def recent(self, body: dict[str, Any]) -> httpx.Response:
        listed = [
            {"id": page_id, "title": title}
            for page_id, (title, space_id) in self.pages.items()
            if space_id == body["spaceId"]
        ]
        start = int(body.get("cursor") or 0)
        chunk = listed[start : start + 2]
        has_next = start + 2 < len(listed)
        meta = {"hasNextPage": has_next, "nextCursor": str(start + 2) if has_next else None}
        return httpx.Response(200, json={"data": {"items": chunk, "meta": meta}})

    def create(self, body: dict[str, Any]) -> httpx.Response:
        page_id = f"page-created-{len(self.created_titles)}"
        self.created_titles.append(body["title"])
        self.pages[page_id] = (body["title"], body["spaceId"])
        return httpx.Response(200, json={"data": {"id": page_id}})

    def ask(self, user: str, body: dict[str, Any]) -> httpx.Response:
        question = body["question"]
        self.asks.append((user, question))
        self.conversation_ids.append(body["conversationId"])
        nth = self.ask_count.get((user, question), 0)
        self.ask_count[(user, question)] = nth + 1
        scripted = self.script(user, question, nth) if self.script else None
        if isinstance(scripted, httpx.Response):
            return scripted
        return sse(scripted if scripted is not None else self.default_answer(question))

    def default_answer(self, question: str) -> Events:
        title = self.question_titles[question]
        ids = [page_id for page_id, (name, _) in self.pages.items() if name == title]
        return [
            {"type": "delta", "text": f"Antwort zu {title}"},
            sources_event(title, ids[0]),
        ]


def write_lists(
    directory: Path,
    canaries: list[dict[str, Any]] | None = None,
    questions: list[dict[str, Any]] | None = None,
) -> None:
    (directory / "generated").mkdir(parents=True)
    canary_list = CANARIES if canaries is None else canaries
    (directory / "generated" / "canaries.json").write_text(json.dumps(canary_list))
    question_list = QUESTIONS if questions is None else questions
    (directory / "canary-questions.json").write_text(json.dumps(question_list))
    (directory / "leak-injection-pages.json").write_text(json.dumps(INJECTION_PAGES))


class Clock:
    def __init__(self) -> None:
        self.now = 0.0
        self.sleeps: list[float] = []

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


@dataclass
class Outcome:
    code: int
    report: str
    wiki: FakeWiki
    clock: Clock
    out: str
    err: str


def run_suite(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    wiki: FakeWiki | None = None,
    canaries: list[dict[str, Any]] | None = None,
    questions: list[dict[str, Any]] | None = None,
) -> Outcome:
    fake = wiki or FakeWiki()
    content = tmp_path / "content"
    write_lists(content, canaries, questions)
    report_path = tmp_path / "reports" / "leak-tests.md"
    report_path.parent.mkdir()
    report_path.write_text(PREVIOUS_REPORT)
    settings = LeakSuiteSettings(
        _env_file=None,  # pyright: ignore[reportCallIssue]
        leak_wiki_url=WIKI_URL,
        leak_report_path=report_path,
        leak_content_dir=content,
    )
    clock = Clock()
    code = run(
        settings,
        client_factory=fake.client,
        sleep=clock.sleep,
        clock=clock,
        today=lambda: date(2026, 3, 5),
    )
    captured = capsys.readouterr()
    return Outcome(code, report_path.read_text(), fake, clock, captured.out, captured.err)


def test_leak_ac21_a_clean_run_exits_0_and_prints_the_summary(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    result = run_suite(tmp_path, capsys)
    assert result.code == 0
    assert f"Leak suite: {TOTAL_QUESTIONS} questions, 0 leaks" in result.out.splitlines()
    assert len(result.wiki.asks) == TOTAL_QUESTIONS
    assert result.wiki.created_titles == [INJECTION_A, INJECTION_B]


def test_leak_ac17_every_denied_user_asks_every_question_of_a_canary_page(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    result = run_suite(tmp_path, capsys)
    asked = set(result.wiki.asks)
    for user in ("PL", "VT"):
        assert (user, FRAGE_VERBATIM) in asked
        assert (user, FRAGE_PARAPHRASE) in asked
    assert ("VT", ANGEBOT_PARAPHRASE) in asked
    assert ("PL", ANGEBOT_PARAPHRASE) not in asked
    assert ("WS", FRAGE_PARAPHRASE) not in asked
    assert ("GF", FRAGE_PARAPHRASE) not in asked


def test_leak_ac18_pl_vt_and_ws_ask_every_injection_page_question(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    result = run_suite(tmp_path, capsys)
    asked = set(result.wiki.asks)
    for user in ("PL", "VT", "WS"):
        assert (user, INJECTION_A_QUESTION) in asked
        assert (user, INJECTION_B_QUESTION) in asked


def test_leak_ac17_every_question_starts_a_new_conversation(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    result = run_suite(tmp_path, capsys)
    assert len(set(result.wiki.conversation_ids)) == TOTAL_QUESTIONS


def test_leak_ac20_the_report_holds_every_item_of_the_run(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    result = run_suite(tmp_path, capsys)
    ask_defaults = AskSettings.model_fields
    lines = result.report.splitlines()
    assert "- Date: 05.03.2026" in lines
    assert f"- Inference mode: {ask_defaults['ai_inference_mode'].default}" in lines
    assert f"- Model: {ask_defaults['ai_llm_model'].default}" in lines
    assert f"- Embedding model: {ask_defaults['ai_embedding_model'].default}" in lines
    for row in ("| GF | 4 |", "| PL | 4 |", "| VT | 6 |", "| WS | 2 |"):
        assert row in lines
    assert "| answered | 16 |" in lines
    assert "| no_source | 0 |" in lines
    assert "| failed | 0 |" in lines
    assert "- Control questions: 4, passed: 4" in lines
    assert "- Leaks: 0" in lines


def test_leak_ac20_the_settings_default_to_the_ask_defaults_and_the_repo_paths(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.delenv("LEAK_WIKI_URL", raising=False)
    with pytest.raises(ValidationError):
        LeakSuiteSettings(_env_file=None)  # pyright: ignore[reportCallIssue]
    settings = LeakSuiteSettings(_env_file=None, leak_wiki_url=WIKI_URL)  # pyright: ignore[reportCallIssue]
    assert settings.leak_report_path.parts[-2:] == ("reports", "leak-tests.md")
    assert (settings.leak_content_dir / "generated" / "canaries.json").is_file()
    assert settings.leak_model == AskSettings.model_fields["ai_llm_model"].default


def test_leak_ac22_a_canary_of_a_denied_page_in_the_text_is_a_leak(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    def script(user: str, question: str, nth: int) -> Events | None:
        if (user, question) == ("PL", FRAGE_PARAPHRASE):
            return [
                {"type": "delta", "text": f"Der Code lautet {UMSTRUKTURIERUNG_CANARY}."},
                sources_event(UMSTRUKTURIERUNG, "page-umstrukturierung"),
            ]
        return None

    result = run_suite(tmp_path, capsys, FakeWiki(script=script))
    assert result.code == 1
    assert f"Leak suite: {TOTAL_QUESTIONS} questions, 1 leaks" in result.out.splitlines()
    assert "- Leaks: 1" in result.report.splitlines()
    assert f"| PL | {FRAGE_PARAPHRASE} | {UMSTRUKTURIERUNG_CANARY} |" in result.report


@pytest.mark.parametrize("field_name", ["title", "spaceName", "fileName"])
def test_leak_ac22_a_canary_in_a_source_entry_is_a_leak(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], field_name: str
):
    def script(user: str, question: str, nth: int) -> Events | None:
        if (user, question) == ("VT", ANGEBOT_PARAPHRASE):
            return [sources_event("Etwas", "page-angebot", **{field_name: ANGEBOT_CANARY})]
        return None

    result = run_suite(tmp_path, capsys, FakeWiki(script=script))
    assert result.code == 1
    assert f"| VT | {ANGEBOT_PARAPHRASE} | {ANGEBOT_CANARY} |" in result.report


def test_leak_ac22_a_canary_in_a_heading_path_is_a_leak(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    def script(user: str, question: str, nth: int) -> Events | None:
        if (user, question) == ("VT", ANGEBOT_PARAPHRASE):
            return [sources_event("Etwas", "page-angebot", headingPath=["A", ANGEBOT_CANARY])]
        return None

    result = run_suite(tmp_path, capsys, FakeWiki(script=script))
    assert result.code == 1
    assert f"| VT | {ANGEBOT_PARAPHRASE} | {ANGEBOT_CANARY} |" in result.report


def test_leak_ac22_a_canary_of_a_page_the_user_may_view_is_no_leak(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    def script(user: str, question: str, nth: int) -> Events | None:
        if (user, question) == ("PL", INJECTION_A_QUESTION):
            return [
                {"type": "delta", "text": f"Das Angebot hat {ANGEBOT_CANARY}."},
                sources_event(ANGEBOT, "page-angebot", title=f"Angebot {ANGEBOT_CANARY}"),
            ]
        return None

    result = run_suite(tmp_path, capsys, FakeWiki(script=script))
    assert result.code == 0
    assert "- Leaks: 0" in result.report.splitlines()


def failed_answers() -> dict[str, Script]:
    def error_event(user: str, question: str, nth: int) -> Events | None:
        if (user, question) == ("VT", FRAGE_PARAPHRASE):
            return [
                {"type": "delta", "text": "Anf"},
                {"type": "error", "code": "model_unavailable"},
            ]
        return None

    def no_final_event(user: str, question: str, nth: int) -> Events | None:
        if (user, question) == ("VT", FRAGE_PARAPHRASE):
            return [{"type": "delta", "text": "Anf"}]
        return None

    def server_error(user: str, question: str, nth: int) -> httpx.Response | None:
        if (user, question) == ("VT", FRAGE_PARAPHRASE):
            return httpx.Response(500)
        return None

    return {"error": error_event, "no_final": no_final_event, "http_500": server_error}


@pytest.mark.parametrize("kind", ["error", "no_final", "http_500"])
def test_leak_ac23_a_failed_answer_is_counted_and_fails_the_run(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], kind: str
):
    result = run_suite(tmp_path, capsys, FakeWiki(script=failed_answers()[kind]))
    assert result.code == 1
    lines = result.report.splitlines()
    assert "| failed | 1 |" in lines
    assert f"| answered | {TOTAL_QUESTIONS - 1} |" in lines
    assert f"Leak suite: {TOTAL_QUESTIONS} questions, 0 leaks" in result.out.splitlines()


def test_leak_ac23_no_source_answers_do_not_fail_the_run(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    def script(user: str, question: str, nth: int) -> Events | None:
        if (user, question) == ("VT", FRAGE_PARAPHRASE):
            return [{"type": "delta", "text": "Nein"}, {"type": "no_source"}]
        return None

    result = run_suite(tmp_path, capsys, FakeWiki(script=script))
    assert result.code == 0
    assert "| no_source | 1 |" in result.report.splitlines()


def test_leak_ac24_a_control_without_a_source_fails_the_run_and_is_named(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    def script(user: str, question: str, nth: int) -> Events | None:
        if (user, question) == ("GF", ANGEBOT_VERBATIM):
            return [{"type": "no_source"}]
        return None

    result = run_suite(tmp_path, capsys, FakeWiki(script=script))
    assert result.code == 1
    assert "- Control questions: 4, passed: 3" in result.report.splitlines()
    assert f"- Failed control: {ANGEBOT} ({ANGEBOT_VERBATIM})" in result.report.splitlines()


def test_leak_ac24_a_control_answered_from_another_page_fails_the_run(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    def script(user: str, question: str, nth: int) -> Events | None:
        if (user, question) == ("GF", ANGEBOT_VERBATIM):
            return [sources_event("Willkommen", "page-willkommen")]
        return None

    result = run_suite(tmp_path, capsys, FakeWiki(script=script))
    assert result.code == 1
    assert f"- Failed control: {ANGEBOT} ({ANGEBOT_VERBATIM})" in result.report.splitlines()


def test_leak_ac19_an_injection_control_is_asked_again_until_its_page_is_cited(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    def script(user: str, question: str, nth: int) -> Events | None:
        if (user, question) == ("GF", INJECTION_A_QUESTION) and nth < 2:
            return [{"type": "no_source"}]
        return None

    result = run_suite(tmp_path, capsys, FakeWiki(script=script))
    assert result.code == 0
    assert result.wiki.ask_count[("GF", INJECTION_A_QUESTION)] == 3
    assert result.clock.sleeps == [5, 5]
    assert f"Leak suite: {TOTAL_QUESTIONS} questions, 0 leaks" in result.out.splitlines()
    assert "- Control questions: 4, passed: 4" in result.report.splitlines()


def test_leak_ac24_an_injection_control_that_is_never_cited_fails_after_the_timeout(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    def script(user: str, question: str, nth: int) -> Events | None:
        if (user, question) == ("GF", INJECTION_B_QUESTION):
            return [{"type": "no_source"}]
        return None

    result = run_suite(tmp_path, capsys, FakeWiki(script=script))
    assert result.code == 1
    assert sum(result.clock.sleeps) == 180
    assert f"- Failed control: {INJECTION_B} ({INJECTION_B_QUESTION})" in result.report.splitlines()
    assert f"Leak suite: {TOTAL_QUESTIONS} questions, 0 leaks" in result.out.splitlines()


def test_leak_ac25_an_unreachable_wiki_exits_2_and_leaves_the_report_alone(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    result = run_suite(tmp_path, capsys, FakeWiki(unreachable=True))
    assert result.code == 2
    assert f"Wiki not reachable at {WIKI_URL}" in result.err
    assert result.report == PREVIOUS_REPORT


def test_leak_ac25_a_failed_login_names_the_user_and_leaves_the_report_alone(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    result = run_suite(tmp_path, capsys, FakeWiki(login_failures={"PL": 9}))
    assert result.code == 2
    assert f"Login failed for PL ({SEED_EMAILS['PL']})" in result.err
    assert result.report == PREVIOUS_REPORT
    assert result.wiki.asks == []
    assert result.wiki.created_titles == []


def test_leak_ac25_a_throttled_login_is_tried_once_more_after_61_seconds(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    wiki = FakeWiki(login_failures={"WS": 1}, login_status={"WS": 429})
    result = run_suite(tmp_path, capsys, wiki)
    assert result.code == 0
    assert result.clock.sleeps == [61]


def test_leak_ac26_an_empty_canary_list_exits_2_before_any_request(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    result = run_suite(tmp_path, capsys, canaries=[])
    assert result.code == 2
    assert "canary list is empty" in result.err.lower()
    assert result.wiki.calls == []
    assert result.report == PREVIOUS_REPORT


def test_leak_ac26_a_canary_page_without_a_question_exits_2_before_any_request(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    questions = [item for item in QUESTIONS if item["pageTitle"] != ANGEBOT]
    result = run_suite(tmp_path, capsys, questions=questions)
    assert result.code == 2
    assert ANGEBOT in result.err
    assert result.wiki.calls == []


def test_leak_ac26_a_question_for_an_unknown_title_exits_2_before_any_request(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    questions = [*QUESTIONS, {"pageTitle": "Gibt es nicht", "kind": "verbatim", "question": "?"}]
    result = run_suite(tmp_path, capsys, questions=questions)
    assert result.code == 2
    assert "Gibt es nicht" in result.err
    assert result.wiki.calls == []


def test_leak_ac26_a_canary_page_the_wiki_does_not_list_exits_2_before_any_ask(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    result = run_suite(tmp_path, capsys, FakeWiki(missing_titles=(ANGEBOT,)))
    assert result.code == 2
    assert ANGEBOT in result.err
    assert result.wiki.asks == []
    assert result.wiki.created_titles == []
    assert result.report == PREVIOUS_REPORT


@pytest.mark.parametrize("failure", [RuntimeError("boom"), KeyboardInterrupt()])
def test_leak_ac27_the_injection_pages_are_deleted_when_the_run_fails(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], failure: BaseException
):
    def script(user: str, question: str, nth: int) -> Events | None:
        if (user, question) == ("PL", FRAGE_PARAPHRASE):
            raise failure
        return None

    wiki = FakeWiki(script=script)
    with pytest.raises(type(failure)):
        run_suite(tmp_path, capsys, wiki)
    assert wiki.created_titles == [INJECTION_A, INJECTION_B]
    assert sorted(wiki.deleted) == [("page-created-0", True), ("page-created-1", True)]
    assert [title for title, _ in wiki.pages.values() if title.startswith("Leak-Test")] == []


def test_leak_ac27_the_injection_pages_are_deleted_after_a_clean_run(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    result = run_suite(tmp_path, capsys)
    assert sorted(result.wiki.deleted) == [("page-created-0", True), ("page-created-1", True)]


def test_leak_ac28_leftover_injection_pages_are_deleted_before_the_new_ones_are_created(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    wiki = FakeWiki(leftovers=(LEFTOVER, "Leak-Test Injektion Alt 2"))
    result = run_suite(tmp_path, capsys, wiki)
    assert result.code == 0
    paths = [path for path, _, _ in wiki.calls]
    deletes = [index for index, path in enumerate(paths) if path == "/api/pages/delete"]
    assert paths.index("/api/pages/create") > deletes[1]
    assert wiki.deleted[:2] == [("page-leftover-0", True), ("page-leftover-1", True)]
    assert "page-willkommen" in wiki.pages
    assert "page-umstrukturierung" in wiki.pages
