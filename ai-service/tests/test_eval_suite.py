import json
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

import anthropic
import httpx
import httpx2
import pytest
from pydantic import SecretStr

from ai_service.eval_judge import JUDGE_MODEL, make_judge_client
from ai_service.eval_sets import AgentScenario, ContractTruth, GoldenQuestion, load_eval_sets
from ai_service.eval_suite import machine_processor, main, run
from ai_service.settings import SEED_CONTENT_DIR, EvalSettings
from ai_service.wiki_session import SEED_EMAILS
from tests.seed_matrix import CANARIES_PATH, SPACE_MEMBERS, load_entries
from tests.test_eval_cases import sse
from tests.test_eval_judge import FULL_VERDICT, JUDGE_KEY, Recorder, message_response

WIKI_URL = "http://wiki.test"
RUN_DATE = date(2026, 10, 30)
PROCESSOR = "Test CPU 3000"
SETS = load_eval_sets(SEED_CONTENT_DIR)
DENIED = {entry["title"]: frozenset(entry["deniedUsers"]) for entry in load_entries(CANARIES_PATH)}
SPACE_NAMES = {entry.file.split("/")[0]: entry.space for entry in SETS.pages}
OTHER_VIEWABLE_PAGE = "Willkommen bei Ostmooimooi"
INJECTION_TITLE = "Leak-Test Injektion 1"
ANSWERED = [question for question in SETS.questions if question.expected_pages]

Event = dict[str, Any]


@dataclass
class WikiPage:
    page_id: str
    space_dir: str
    title: str
    markdown: str
    attachments: list[str]


def seed_wiki_pages(
    extra_titles: tuple[str, ...], missing_titles: tuple[str, ...]
) -> list[WikiPage]:
    pages = [
        WikiPage(
            f"page-{index}",
            entry.file.split("/")[0],
            entry.title,
            f"# {entry.title}",
            list(entry.attachments),
        )
        for index, entry in enumerate(SETS.pages)
        if entry.title not in missing_titles
    ]
    extra = [
        WikiPage(f"page-extra-{index}", "allgemein", title, "# x", [])
        for index, title in enumerate(extra_titles)
    ]
    return pages + extra


def default_answer(question: GoldenQuestion, page_ids: dict[str, str]) -> list[Event]:
    if not question.expected_pages:
        return [{"type": "no_source"}]
    sources = [
        {"pageId": page_ids[title], "title": title, "fileName": None}
        for title in question.expected_pages
    ]
    return [
        {"type": "delta", "text": "Antwort laut Seite [1]."},
        {"type": "sources", "sources": sources},
    ]


def default_extraction(contract: ContractTruth) -> dict[str, Any]:
    if not contract.text_layer:
        return {"outcome": "refused", "reason": "no_text_layer"}
    fields = [
        {"key": key, "value": truth.value, "quote": truth.quote, "pdfPage": truth.pdf_page}
        for key, truth in contract.fields.items()
    ]
    return {"outcome": "extracted", "fields": fields}


def default_agent_run(scenario: AgentScenario) -> list[Event]:
    proposals = [
        {"type": "proposal", "proposal": {"pageTitle": title}}
        for title in scenario.expected_proposal_pages
    ]
    end = {"type": "end", "outcome": scenario.expected_outcomes[0], "pagesRead": 2, "message": None}
    return [{"type": "run", "runId": f"run-{scenario.id}"}, *proposals, end]


@dataclass
class FakeWiki:
    unreachable: bool = False
    login_status: dict[str, int] = field(default_factory=dict)
    extra_titles: tuple[str, ...] = ()
    missing_titles: tuple[str, ...] = ()
    denied_views: frozenset[tuple[str, str]] = frozenset()
    hidden_spaces: frozenset[tuple[str, str]] = frozenset()
    missing_attachments: frozenset[str] = frozenset()
    answers: dict[str, list[Event]] = field(default_factory=dict)
    agent_writes: dict[str, str] = field(default_factory=dict)
    requests: list[httpx.Request] = field(default_factory=list)
    calls: list[tuple[str, str, dict[str, Any]]] = field(default_factory=list)
    clients_made: int = 0

    def __post_init__(self) -> None:
        self.pages = {
            page.page_id: page for page in seed_wiki_pages(self.extra_titles, self.missing_titles)
        }
        self.questions = {question.question: question for question in SETS.questions}
        self.scenarios = {scenario.task: scenario for scenario in SETS.scenarios}
        self.contracts = {f"att-{contract.pdf}": contract for contract in SETS.contracts}

    def client(self) -> httpx.Client:
        self.clients_made += 1
        return httpx.Client(base_url=WIKI_URL, transport=httpx.MockTransport(self.handle))

    def page_ids(self) -> dict[str, str]:
        return {page.title: page.page_id for page in self.pages.values()}

    def may_view(self, user: str, page: WikiPage) -> bool:
        return (
            page.space_dir in SPACE_MEMBERS[user]
            and user not in DENIED.get(page.title, frozenset())
            and (user, page.title) not in self.denied_views
        )

    def paths(self, path: str) -> list[tuple[str, str, dict[str, Any]]]:
        return [call for call in self.calls if call[0] == path]

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.unreachable:
            raise httpx.ConnectError("refused", request=request)
        body = json.loads(request.content) if request.content else {}
        user = request.headers.get("cookie", "").removeprefix("authToken=")
        path = request.url.path
        self.calls.append((path, user, body))
        routes: dict[str, Callable[[str, dict[str, Any]], httpx.Response]] = {
            "/api/auth/login": self.login,
            "/api/spaces": self.spaces,
            "/api/pages/recent": self.recent,
            "/api/pages/info": self.info,
            "/api/ai/ask": self.ask,
            "/api/ai/extract": self.extract,
            "/api/ai/agent/run": self.agent_run,
        }
        route = routes.get(path)
        return route(user, body) if route else httpx.Response(404)

    def login(self, user: str, body: dict[str, Any]) -> httpx.Response:
        [key] = [name for name, email in SEED_EMAILS.items() if email == body["email"]]
        status = self.login_status.get(key, 200)
        if status != 200:
            return httpx.Response(status)
        return httpx.Response(200, headers={"set-cookie": f"authToken={key}; Path=/"})

    def spaces(self, user: str, body: dict[str, Any]) -> httpx.Response:
        items = [
            {"id": f"space-{space_dir}", "name": SPACE_NAMES[space_dir]}
            for space_dir in sorted(SPACE_MEMBERS[user])
            if (user, SPACE_NAMES[space_dir]) not in self.hidden_spaces
        ]
        return httpx.Response(200, json={"data": {"items": items}})

    def recent(self, user: str, body: dict[str, Any]) -> httpx.Response:
        listed = [
            {"id": page.page_id, "title": page.title}
            for page in self.pages.values()
            if f"space-{page.space_dir}" == body["spaceId"] and self.may_view(user, page)
        ]
        start = int(body.get("cursor") or 0)
        chunk = listed[start : start + 4]
        has_next = start + 4 < len(listed)
        meta = {"hasNextPage": has_next, "nextCursor": str(start + 4) if has_next else None}
        return httpx.Response(200, json={"data": {"items": chunk, "meta": meta}})

    def info(self, user: str, body: dict[str, Any]) -> httpx.Response:
        page = self.pages.get(body["pageId"])
        if page is None:
            return httpx.Response(404)
        if not self.may_view(user, page):
            return httpx.Response(403)
        if body.get("format") == "markdown":
            return httpx.Response(
                200, json={"data": {"title": page.title, "content": page.markdown}}
            )
        nodes = [
            {"type": "attachment", "attrs": {"name": name, "attachmentId": f"att-{name}"}}
            for name in page.attachments
            if name not in self.missing_attachments
        ]
        content = {"type": "doc", "content": [{"type": "paragraph"}, *nodes]}
        return httpx.Response(200, json={"data": {"title": page.title, "content": content}})

    def ask(self, user: str, body: dict[str, Any]) -> httpx.Response:
        question = self.questions[body["question"]]
        events = self.answers.get(question.id) or default_answer(question, self.page_ids())
        return httpx.Response(200, content=sse(*events))

    def extract(self, user: str, body: dict[str, Any]) -> httpx.Response:
        contract = self.contracts[body["attachmentId"]]
        return httpx.Response(200, json={"data": default_extraction(contract)})

    def agent_run(self, user: str, body: dict[str, Any]) -> httpx.Response:
        scenario = self.scenarios[body["task"]]
        written = self.agent_writes.get(scenario.id)
        if written is not None:
            [page] = [page for page in self.pages.values() if page.title == written]
            page.markdown += "\n\nGeändert ohne Bestätigung."
        return httpx.Response(200, content=sse(*default_agent_run(scenario)))


@dataclass
class EvalRunResult:
    code: int
    judge: Recorder
    judge_clients: int
    report: Path
    thresholds: Path
    sleeps: list[float]


def settings_for(tmp_path: Path, key: str | None) -> EvalSettings:
    return EvalSettings(
        _env_file=None,  # pyright: ignore[reportCallIssue]
        eval_wiki_url=WIKI_URL,
        eval_anthropic_api_key=SecretStr(key) if key is not None else None,
        eval_report_path=tmp_path / "reports" / "eval-local.md",
        eval_thresholds_path=tmp_path / "reports" / "eval-thresholds.json",
        eval_content_dir=SEED_CONTENT_DIR,
    )


def run_eval(
    tmp_path: Path, wiki: FakeWiki, no_judge: bool = False, key: str | None = JUDGE_KEY
) -> EvalRunResult:
    recorder = Recorder(lambda request: message_response(FULL_VERDICT))
    judge_clients: list[str] = []
    sleeps: list[float] = []

    def judge_client(api_key: str) -> anthropic.Anthropic:
        judge_clients.append(api_key)
        transport = httpx2.MockTransport(recorder)
        return make_judge_client(api_key, http_client=httpx2.Client(transport=transport))

    settings = settings_for(tmp_path, key)
    code = run(
        settings,
        no_judge,
        client_factory=wiki.client,
        judge_client_factory=judge_client,
        sleep=sleeps.append,
        clock=lambda: 0.0,
        today=lambda: RUN_DATE,
        processor=lambda: PROCESSOR,
    )
    return EvalRunResult(
        code,
        recorder,
        len(judge_clients),
        settings.eval_report_path,
        settings.eval_thresholds_path,
        sleeps,
    )


def metric_row(report: str, metric: str) -> str:
    [row] = [line for line in report.splitlines() if line.startswith(f"| {metric} |")]
    return row


def last_line(text: str) -> str:
    return text.rstrip("\n").splitlines()[-1]


def pre_create_files(tmp_path: Path) -> tuple[bytes, bytes]:
    report = tmp_path / "reports" / "eval-local.md"
    thresholds = tmp_path / "reports" / "eval-thresholds.json"
    report.parent.mkdir(parents=True)
    report.write_text("# Evals\n\nold report\n")
    thresholds.write_text('{"entries": []}\n')
    return report.read_bytes(), thresholds.read_bytes()


def assert_files_unchanged(tmp_path: Path, before: tuple[bytes, bytes]) -> None:
    report = tmp_path / "reports" / "eval-local.md"
    thresholds = tmp_path / "reports" / "eval-thresholds.json"
    assert (report.read_bytes(), thresholds.read_bytes()) == before
    assert sorted(path.name for path in report.parent.iterdir()) == [
        "eval-local.md",
        "eval-thresholds.json",
    ]


def test_eval_ac49_a_clean_judged_run_exits_0_sets_baselines_and_prints_the_summary(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    wiki = FakeWiki()
    result = run_eval(tmp_path, wiki)
    out = capsys.readouterr().out
    assert result.code == 0
    assert last_line(out) == "Evals: 9 of 9 metrics passed"
    report = result.report.read_text()
    assert f"- Judge: {JUDGE_MODEL}" in report
    assert f"- Processor: {PROCESSOR}" in report
    assert "- Date: 30.10.2026" in report
    assert all(
        "| baseline set |" in metric_row(report, name)
        for name in ("rag_groundedness", "agent_task_success")
    )
    entries = json.loads(result.thresholds.read_text())["entries"]
    assert len(entries) == 9
    assert {entry["judgeModel"] for entry in entries} == {JUDGE_MODEL}
    assert len(result.judge.requests) == len(ANSWERED)


def test_eval_ac49_each_case_runs_once_as_its_user_through_the_wiki(tmp_path: Path):
    wiki = FakeWiki()
    run_eval(tmp_path, wiki)
    asks = [(user, body["question"]) for _, user, body in wiki.paths("/api/ai/ask")]
    assert asks == [(question.user, question.question) for question in SETS.questions]
    extractions = [(user, body["attachmentId"]) for _, user, body in wiki.paths("/api/ai/extract")]
    assert extractions == [("GF", f"att-{contract.pdf}") for contract in SETS.contracts]
    runs = [(user, body) for _, user, body in wiki.paths("/api/ai/agent/run")]
    expected_runs = [
        (scenario.user, {"spaceId": f"space-{dir_of(scenario.space)}", "task": scenario.task})
        for scenario in SETS.scenarios
    ]
    assert runs == expected_runs
    assert not [call for call in wiki.calls if "apply" in call[0] or "discard" in call[0]]


def dir_of(space_name: str) -> str:
    [space_dir] = [space_dir for space_dir, name in SPACE_NAMES.items() if name == space_name]
    return space_dir


def test_eval_ac49_a_second_identical_run_compares_with_the_thresholds_and_passes(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    run_eval(tmp_path, FakeWiki())
    thresholds_before = (tmp_path / "reports" / "eval-thresholds.json").read_bytes()
    capsys.readouterr()
    result = run_eval(tmp_path, FakeWiki())
    out = capsys.readouterr().out
    assert result.code == 0
    assert last_line(out) == "Evals: 9 of 9 metrics passed"
    report = result.report.read_text()
    assert "baseline set" not in report
    assert "| 90 % | passed |" in metric_row(report, "rag_citation_accuracy")
    assert result.thresholds.read_bytes() == thresholds_before


def test_eval_ac20_no_judge_makes_no_judge_request_and_reports_judge_not_run(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    result = run_eval(tmp_path, FakeWiki(), no_judge=True, key=None)
    out = capsys.readouterr().out
    assert result.code == 0
    assert result.judge.requests == []
    assert result.judge_clients == 0
    report = result.report.read_text()
    assert "- Judge: not run" in report
    assert "| not judged |" in metric_row(report, "rag_answer_correctness")
    assert "| not judged |" in metric_row(report, "rag_groundedness")
    assert last_line(out) == "Evals: 7 of 7 metrics passed"
    metrics = {entry["metric"] for entry in json.loads(result.thresholds.read_text())["entries"]}
    assert not metrics & {"rag_answer_correctness", "rag_groundedness"}


def test_eval_ac20_no_judge_with_a_key_set_still_makes_no_judge_request(tmp_path: Path):
    result = run_eval(tmp_path, FakeWiki(), no_judge=True)
    assert result.judge.requests == []
    assert result.judge_clients == 0
    assert "- Judge: not run" in result.report.read_text()


def test_eval_ac51_a_model_failure_is_a_failed_request_exits_1_and_adds_no_threshold(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    failing = [{"type": "delta", "text": "x"}, {"type": "error", "code": "model_unavailable"}]
    result = run_eval(tmp_path, FakeWiki(answers={"rag-03": failing}))
    out = capsys.readouterr().out
    assert result.code == 1
    report = result.report.read_text()
    assert "Failed requests: 1" in report
    assert "- rag-03: model_unavailable" in report
    assert not result.thresholds.exists()
    assert last_line(out).startswith("Evals: ")
    assert len(result.judge.requests) == len(ANSWERED) - 1


def test_eval_ac37_an_agent_run_that_changes_a_page_exits_1(tmp_path: Path):
    wiki = FakeWiki(agent_writes={"agent-01": "Reisekosten Richtlinie 2022"})
    result = run_eval(tmp_path, wiki)
    assert result.code == 1
    report = result.report.read_text()
    assert "| failed |" in metric_row(report, "agent_no_unconfirmed_write")
    [agent_row] = [line for line in report.splitlines() if line.startswith("| agent-01 |")]
    assert "Reisekosten Richtlinie 2022 |" in agent_row.split("| yes |")[-1]


def test_eval_ac43_a_metric_below_its_threshold_fails_keeps_it_and_exits_1(tmp_path: Path):
    run_eval(tmp_path, FakeWiki())
    thresholds_path = tmp_path / "reports" / "eval-thresholds.json"
    document = json.loads(thresholds_path.read_text())
    for entry in document["entries"]:
        if entry["metric"] == "rag_citation_accuracy":
            entry["threshold"] = "80"
    thresholds_path.write_text(json.dumps(document))
    edited = thresholds_path.read_bytes()
    wiki = FakeWiki()
    page_ids = wiki.page_ids()
    wrong = {}
    for question in ANSWERED[:4]:
        events = default_answer(question, page_ids)
        events[-1]["sources"].append(
            {
                "pageId": page_ids[OTHER_VIEWABLE_PAGE],
                "title": OTHER_VIEWABLE_PAGE,
                "fileName": None,
            }
        )
        wrong[question.id] = events
    wiki.answers = wrong
    result = run_eval(tmp_path, wiki)
    assert result.code == 1
    row = metric_row(result.report.read_text(), "rag_citation_accuracy")
    assert "| 11 of 15 | 73.3 % | 80 % | failed |" in row
    assert thresholds_path.read_bytes() == edited


@pytest.mark.parametrize("key", [None, "", "   "])
def test_eval_ac58_without_a_key_and_without_no_judge_exits_2_before_any_wiki_request(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], key: str | None
):
    wiki = FakeWiki()
    result = run_eval(tmp_path, wiki, key=key)
    err = capsys.readouterr().err
    assert result.code == 2
    assert "EVAL_ANTHROPIC_API_KEY" in err
    assert wiki.requests == []
    assert wiki.clients_made == 0
    assert result.judge_clients == 0
    assert not result.report.exists()


def test_eval_ac59_an_unreachable_wiki_exits_2_naming_the_url_and_keeps_the_files(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    before = pre_create_files(tmp_path)
    result = run_eval(tmp_path, FakeWiki(unreachable=True))
    err = capsys.readouterr().err
    assert result.code == 2
    assert f"Wiki not reachable at {WIKI_URL}" in err
    assert_files_unchanged(tmp_path, before)


@pytest.mark.parametrize("user", ["GF", "WS"])
def test_eval_ac59_a_failed_login_exits_2_naming_the_user_and_keeps_the_files(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], user: str
):
    before = pre_create_files(tmp_path)
    wiki = FakeWiki(login_status={user: 401})
    result = run_eval(tmp_path, wiki)
    err = capsys.readouterr().err
    assert result.code == 2
    assert f"Login failed for {user} ({SEED_EMAILS[user]})" in err
    assert wiki.paths("/api/ai/ask") == []
    assert_files_unchanged(tmp_path, before)


def test_eval_ac59_a_throttled_login_waits_and_retries(tmp_path: Path):
    wiki = FakeWiki()
    attempts: dict[str, int] = {}
    original = wiki.login

    def throttled(user: str, body: dict[str, Any]) -> httpx.Response:
        attempts[body["email"]] = attempts.get(body["email"], 0) + 1
        if body["email"] == SEED_EMAILS["PL"] and attempts[body["email"]] == 1:
            return httpx.Response(429)
        return original(user, body)

    wiki.login = throttled  # pyright: ignore[reportAttributeAccessIssue]
    result = run_eval(tmp_path, wiki)
    assert result.code == 0
    assert result.sleeps == [61]


def test_eval_ac60_an_asker_who_may_not_view_an_expected_page_exits_2_naming_the_question(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    before = pre_create_files(tmp_path)
    wiki = FakeWiki(denied_views=frozenset({("VT", "Reisekosten Richtlinie 2026")}))
    result = run_eval(tmp_path, wiki)
    err = capsys.readouterr().err
    assert result.code == 2
    assert "rag-01" in err
    assert wiki.paths("/api/ai/ask") == []
    info_users = {user for _, user, body in wiki.paths("/api/pages/info") if "format" not in body}
    assert "VT" in info_users
    assert_files_unchanged(tmp_path, before)


def test_eval_ac60_an_expected_page_the_wiki_does_not_have_exits_2_naming_the_question(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    wiki = FakeWiki(missing_titles=("VPN Einrichtung Connect",))
    result = run_eval(tmp_path, wiki)
    err = capsys.readouterr().err
    assert result.code == 2
    assert "rag-02" in err
    assert wiki.paths("/api/ai/ask") == []


def test_eval_ac61_a_user_who_is_not_a_member_of_the_scenario_space_exits_2_naming_it(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    before = pre_create_files(tmp_path)
    wiki = FakeWiki(hidden_spaces=frozenset({("PL", "Allgemein")}))
    result = run_eval(tmp_path, wiki)
    err = capsys.readouterr().err
    assert result.code == 2
    assert "agent-06" in err
    assert wiki.paths("/api/ai/ask") == []
    assert_files_unchanged(tmp_path, before)


def test_eval_ac62_a_contract_without_its_attachment_in_the_wiki_exits_2_naming_the_file(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    before = pre_create_files(tmp_path)
    wiki = FakeWiki(missing_attachments=frozenset({"liefervertrag-pumpen-fiktivwerk.pdf"}))
    result = run_eval(tmp_path, wiki)
    err = capsys.readouterr().err
    assert result.code == 2
    assert "liefervertrag-pumpen-fiktivwerk.pdf" in err
    assert wiki.paths("/api/ai/ask") == []
    assert_files_unchanged(tmp_path, before)


def test_eval_ac21_a_non_seed_page_with_the_judge_exits_2_naming_it(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    before = pre_create_files(tmp_path)
    wiki = FakeWiki(extra_titles=(INJECTION_TITLE,))
    result = run_eval(tmp_path, wiki)
    err = capsys.readouterr().err
    assert result.code == 2
    assert INJECTION_TITLE in err
    assert wiki.paths("/api/ai/ask") == []
    assert result.judge.requests == []
    assert_files_unchanged(tmp_path, before)


def test_eval_ac21_a_non_seed_page_without_the_judge_lets_the_run_proceed(tmp_path: Path):
    wiki = FakeWiki(extra_titles=(INJECTION_TITLE,))
    result = run_eval(tmp_path, wiki, no_judge=True)
    assert result.code == 0
    assert len(wiki.paths("/api/ai/ask")) == len(SETS.questions)


def test_eval_ac17_the_key_reaches_only_the_judge_requests(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    wiki = FakeWiki()
    result = run_eval(tmp_path, wiki)
    captured = capsys.readouterr()
    assert result.code == 0
    assert wiki.requests
    for request in wiki.requests:
        assert JUDGE_KEY not in str(request.url)
        assert all(JUDGE_KEY not in value for value in request.headers.values())
        assert JUDGE_KEY.encode() not in request.content
    assert JUDGE_KEY not in captured.out
    assert JUDGE_KEY not in captured.err
    assert JUDGE_KEY not in result.report.read_text()
    assert JUDGE_KEY not in result.thresholds.read_text()
    assert result.judge.requests
    for request in result.judge.requests:
        assert any(JUDGE_KEY in value for value in request.headers.values())
        assert JUDGE_KEY not in str(request.url)
        assert JUDGE_KEY.encode() not in request.content


def test_eval_ac17_a_settings_error_names_the_setting_without_printing_the_key(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("EVAL_ANTHROPIC_API_KEY", JUDGE_KEY)
    monkeypatch.delenv("EVAL_WIKI_URL", raising=False)
    with pytest.raises(SystemExit) as exit_info:
        main([])
    captured = capsys.readouterr()
    assert exit_info.value.code == 2
    assert "EVAL_WIKI_URL" in captured.err
    assert JUDGE_KEY not in captured.out + captured.err


def test_eval_ac63_an_invalid_threshold_list_exits_2_before_any_wiki_request(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    thresholds = tmp_path / "reports" / "eval-thresholds.json"
    thresholds.parent.mkdir(parents=True)
    thresholds.write_text('{"entries": 5}')
    wiki = FakeWiki()
    result = run_eval(tmp_path, wiki)
    err = capsys.readouterr().err
    assert result.code == 2
    assert str(thresholds) in err
    assert wiki.requests == []
    assert not result.report.exists()
    assert thresholds.read_text() == '{"entries": 5}'


def test_eval_ac48_the_processor_name_falls_back_off_macos(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr("platform.system", lambda: "Linux")
    monkeypatch.setattr("platform.processor", lambda: "")
    monkeypatch.setattr("platform.machine", lambda: "x86_64")
    assert machine_processor() == "x86_64"
    monkeypatch.setattr("platform.processor", lambda: "Fake Xeon")
    assert machine_processor() == "Fake Xeon"
