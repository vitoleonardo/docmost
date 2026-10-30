import argparse
import platform
import subprocess
import sys
import time
from collections.abc import Callable, Sequence
from contextlib import ExitStack
from dataclasses import dataclass, replace
from datetime import date
from pathlib import Path

import anthropic
import httpx
from pydantic import ValidationError

from ai_service.eval_cases import (
    Clock,
    agent_case,
    ask_case,
    extract_case,
    page_attachments,
    workspace_snapshot,
)
from ai_service.eval_judge import (
    JUDGE_INSTRUCTIONS,
    JUDGE_MODEL,
    Judge,
    JudgeFailed,
    make_judge_client,
    seed_source_texts,
)
from ai_service.eval_metrics import (
    DATE_FORMAT,
    AgentCase,
    ExtractionCase,
    RagCase,
    RunInfo,
    ThresholdList,
    compute_metrics,
    evaluate,
    exit_status,
    load_thresholds,
    write_thresholds,
)
from ai_service.eval_report import (
    EvalRun,
    failed_judgements,
    failed_requests,
    render_report,
    summary_line,
)
from ai_service.eval_sets import EvalSets, SeedPageEntry, check_eval_sets, load_eval_sets
from ai_service.request_log_report import replace_file
from ai_service.settings import EvalSettings
from ai_service.wiki_session import (
    ClientFactory,
    Sleep,
    StartFailed,
    default_client_factory,
    list_space_pages,
    log_in_all,
    post_data,
)
from ai_service.worker import describe_settings_error

EXTRACTING_USER = "GF"
WIKI_TIMEOUT = httpx.Timeout(60, connect=10)
EXIT_START_FAILED = 2
KEY_SETTING = "EVAL_ANTHROPIC_API_KEY"
MACOS_PROCESSOR_COMMAND = ("sysctl", "-n", "machdep.cpu.brand_string")

JudgeClientFactory = Callable[[str], anthropic.Anthropic]


@dataclass(frozen=True)
class CaseTargets:
    contract_targets: dict[str, tuple[str, str]]
    scenario_spaces: dict[str, str]


@dataclass(frozen=True)
class Cases:
    rag: list[RagCase]
    extraction: list[ExtractionCase]
    agent: list[AgentCase]


def machine_processor() -> str:
    if platform.system() == "Darwin":
        try:
            brand = subprocess.run(
                MACOS_PROCESSOR_COMMAND, capture_output=True, text=True, check=True
            ).stdout.strip()
        except OSError, subprocess.CalledProcessError:
            brand = ""
        if brand:
            return brand
    return platform.processor() or platform.machine()


def judge_key(settings: EvalSettings) -> str:
    key = settings.eval_anthropic_api_key
    if key is None or not key.get_secret_value().strip():
        raise StartFailed(f"{KEY_SETTING} is not set; set it or run with --no-judge")
    return key.get_secret_value()


def wiki_page_ids(gf: httpx.Client) -> dict[str, str]:
    page_ids: dict[str, str] = {}
    for space in post_data(gf, "/api/spaces", {})["items"]:
        for page in list_space_pages(gf, space["id"]):
            page_ids.setdefault(page["title"], page["id"])
    return page_ids


def check_seed_titles(page_ids: dict[str, str], pages: list[SeedPageEntry]) -> None:
    seed_titles = {entry.title for entry in pages}
    foreign = sorted(title for title in page_ids if title not in seed_titles)
    if foreign:
        raise StartFailed(f"The wiki holds pages that are not seed data: {', '.join(foreign)}")


def check_expected_pages_exist(sets: EvalSets, page_ids: dict[str, str]) -> None:
    for question in sets.questions:
        for title in question.expected_pages:
            if title not in page_ids:
                raise StartFailed(f"Golden question {question.id}: the wiki has no page {title}")


def scenario_spaces(sets: EvalSets, clients: dict[str, httpx.Client]) -> dict[str, str]:
    member_spaces: dict[str, dict[str, str]] = {}
    found: dict[str, str] = {}
    for scenario in sets.scenarios:
        if scenario.user not in member_spaces:
            items = post_data(clients[scenario.user], "/api/spaces", {})["items"]
            member_spaces[scenario.user] = {space["name"]: space["id"] for space in items}
        space_id = member_spaces[scenario.user].get(scenario.space)
        if space_id is None:
            raise StartFailed(
                f"Agent scenario {scenario.id}: {scenario.user} is not a member of the space "
                f"{scenario.space}"
            )
        found[scenario.id] = space_id
    return found


def contract_targets(
    sets: EvalSets, page_ids: dict[str, str], gf: httpx.Client
) -> dict[str, tuple[str, str]]:
    targets: dict[str, tuple[str, str]] = {}
    for contract in sets.contracts:
        entry = next(page for page in sets.pages if contract.pdf in page.attachments)
        page_id = page_ids.get(entry.title)
        attachment_id = page_attachments(gf, page_id).get(contract.pdf) if page_id else None
        if page_id is None or attachment_id is None:
            raise StartFailed(f"The wiki has no attachment for the contract {contract.pdf}")
        targets[contract.pdf] = (page_id, attachment_id)
    return targets


def find_case_targets(
    sets: EvalSets, clients: dict[str, httpx.Client], judged: bool
) -> CaseTargets:
    gf = clients[EXTRACTING_USER]
    page_ids = wiki_page_ids(gf)
    if judged:
        check_seed_titles(page_ids, sets.pages)
    check_expected_pages_exist(sets, page_ids)
    spaces = scenario_spaces(sets, clients)
    return CaseTargets(contract_targets(sets, page_ids, gf), spaces)


def check_wiki(
    sets: EvalSets, clients: dict[str, httpx.Client], judged: bool, wiki_url: str
) -> CaseTargets:
    try:
        return find_case_targets(sets, clients, judged)
    except httpx.TransportError as error:
        raise StartFailed(f"Wiki not reachable at {wiki_url}") from error
    except httpx.HTTPStatusError as error:
        raise StartFailed(
            f"The wiki answered {error.response.status_code} to {error.request.url.path} "
            f"during the start checks"
        ) from error


def judged_case(case: RagCase, judge: Judge, sets: EvalSets, content_dir: Path) -> RagCase:
    if case.outcome != "answered":
        return case
    question = case.question
    reference = question.reference_answer if question.expected_pages else None
    try:
        sources = seed_source_texts(case.sources, sets.pages, content_dir)
        ratings = judge.rate(question.question, reference, case.answer_text, sources)
    except JudgeFailed as failure:
        return replace(case, judge_failure=failure.error_class)
    return replace(case, ratings=ratings)


def run_cases(
    sets: EvalSets,
    clients: dict[str, httpx.Client],
    targets: CaseTargets,
    judge: Judge | None,
    content_dir: Path,
    clock: Clock,
) -> Cases:
    gf = clients[EXTRACTING_USER]
    rag = [ask_case(clients[question.user], question, clock) for question in sets.questions]
    if judge is not None:
        rag = [judged_case(case, judge, sets, content_dir) for case in rag]
    extraction = [
        extract_case(gf, contract, *targets.contract_targets[contract.pdf], clock)
        for contract in sets.contracts
    ]
    agent = [
        agent_case(
            clients[scenario.user],
            scenario,
            targets.scenario_spaces[scenario.id],
            lambda: workspace_snapshot(gf),
            clock,
        )
        for scenario in sets.scenarios
    ]
    return Cases(rag, extraction, agent)


def finish(
    settings: EvalSettings,
    thresholds: ThresholdList,
    cases: Cases,
    judged: bool,
    run_date: date,
    processor: str,
) -> int:
    judge_model = JUDGE_MODEL if judged else None
    draft = EvalRun(
        run_date,
        settings.eval_inference_mode,
        settings.eval_model,
        settings.eval_embedding_model,
        processor,
        judge_model,
        JUDGE_INSTRUCTIONS if judged else None,
        cases.rag,
        cases.extraction,
        cases.agent,
        [],
    )
    requests_failed = len(failed_requests(draft))
    judgements_failed = len(failed_judgements(draft))
    results, updated = evaluate(
        compute_metrics(cases.rag, cases.extraction, cases.agent, judged),
        thresholds,
        settings.eval_inference_mode,
        settings.eval_model,
        requests_failed == 0 and judgements_failed == 0,
        judged,
        RunInfo(run_date.strftime(DATE_FORMAT), settings.eval_embedding_model, judge_model),
    )
    replace_file(settings.eval_report_path, render_report(replace(draft, results=results)))
    if updated != thresholds:
        settings.eval_thresholds_path.parent.mkdir(parents=True, exist_ok=True)
        write_thresholds(settings.eval_thresholds_path, updated)
    print(summary_line(results))
    return exit_status(results, requests_failed, judgements_failed)


def run_suite(
    settings: EvalSettings,
    no_judge: bool,
    client_factory: ClientFactory,
    judge_client_factory: JudgeClientFactory,
    sleep: Sleep,
    clock: Clock,
    today: Callable[[], date],
    processor: Callable[[], str],
) -> int:
    judge = None if no_judge else Judge(judge_client_factory(judge_key(settings)))
    thresholds = load_thresholds(settings.eval_thresholds_path)
    sets = load_eval_sets(settings.eval_content_dir)
    check_eval_sets(sets)
    with ExitStack() as stack:
        clients = log_in_all(
            stack, client_factory, settings.eval_wiki_url, settings.eval_seed_password, sleep
        )
        targets = check_wiki(sets, clients, judge is not None, settings.eval_wiki_url)
        cases = run_cases(sets, clients, targets, judge, settings.eval_content_dir, clock)
    return finish(settings, thresholds, cases, judge is not None, today(), processor())


def run(
    settings: EvalSettings,
    no_judge: bool,
    client_factory: ClientFactory | None = None,
    judge_client_factory: JudgeClientFactory | None = None,
    sleep: Sleep = time.sleep,
    clock: Clock = time.monotonic,
    today: Callable[[], date] = date.today,
    processor: Callable[[], str] = machine_processor,
) -> int:
    factory = client_factory or default_client_factory(settings.eval_wiki_url, WIKI_TIMEOUT)
    try:
        return run_suite(
            settings,
            no_judge,
            factory,
            judge_client_factory or make_judge_client,
            sleep,
            clock,
            today,
            processor,
        )
    except StartFailed as error:
        print(error, file=sys.stderr)
        return EXIT_START_FAILED


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m ai_service.eval_suite")
    parser.add_argument("--no-judge", action="store_true", help="make no judge call")
    args = parser.parse_args(argv)
    try:
        settings = EvalSettings()  # pyright: ignore[reportCallIssue]
    except ValidationError as error:
        print(describe_settings_error(error), file=sys.stderr)
        sys.exit(EXIT_START_FAILED)
    sys.exit(run(settings, args.no_judge))


if __name__ == "__main__":
    main()
