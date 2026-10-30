import json
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ai_service.wiki_session import SEED_EMAILS, StartFailed

GOLDEN_QUESTIONS_FILE = "golden-questions.json"
AGENT_SCENARIOS_FILE = "agent-scenarios.json"
GROUND_TRUTH_FILE = "generated/ground-truth.json"
SEED_PAGES_FILE = "generated/pages.json"

Entry = dict[str, Any]


@dataclass(frozen=True)
class GoldenQuestion:
    id: str
    user: str
    question: str
    expected_pages: list[str]
    answered_by: str | None
    reference_answer: str | None
    key_fact: str | None


@dataclass(frozen=True)
class AgentScenario:
    id: str
    user: str
    space: str
    task: str
    expected_outcomes: list[str]
    expected_proposal_pages: list[str]


@dataclass(frozen=True)
class FieldTruth:
    value: str | None
    quote: str | None
    pdf_page: int | None

    @property
    def missing(self) -> bool:
        return self.value is None


@dataclass(frozen=True)
class ContractTruth:
    pdf: str
    text_layer: bool
    fields: dict[str, FieldTruth]


@dataclass(frozen=True)
class SeedPageEntry:
    space: str
    title: str
    file: str
    attachments: list[str]


@dataclass(frozen=True)
class EvalSets:
    questions: list[GoldenQuestion]
    scenarios: list[AgentScenario]
    contracts: list[ContractTruth]
    pages: list[SeedPageEntry]


def golden_question(entry: Entry) -> GoldenQuestion:
    return GoldenQuestion(
        id=entry["id"],
        user=entry["user"],
        question=entry["question"],
        expected_pages=list(entry["expectedPages"]),
        answered_by=entry["answeredBy"],
        reference_answer=entry["referenceAnswer"],
        key_fact=entry["keyFact"],
    )


def agent_scenario(entry: Entry) -> AgentScenario:
    return AgentScenario(
        id=entry["id"],
        user=entry["user"],
        space=entry["space"],
        task=entry["task"],
        expected_outcomes=list(entry["expectedOutcomes"]),
        expected_proposal_pages=list(entry["expectedProposalPages"]),
    )


def field_truth(entry: Entry) -> FieldTruth:
    if entry.get("missing"):
        return FieldTruth(value=None, quote=None, pdf_page=None)
    return FieldTruth(value=entry["value"], quote=entry["quote"], pdf_page=entry["pdfPage"])


def contract_truth(entry: Entry) -> ContractTruth:
    return ContractTruth(
        pdf=entry["pdf"],
        text_layer=entry["textLayer"],
        fields={key: field_truth(field) for key, field in entry["fields"].items()},
    )


def seed_page_entry(entry: Entry) -> SeedPageEntry:
    return SeedPageEntry(
        space=entry["space"],
        title=entry["title"],
        file=entry["file"],
        attachments=list(entry["attachments"]),
    )


def read_list[T](content_dir: Path, name: str, build: Callable[[Entry], T]) -> list[T]:
    path = content_dir / name
    try:
        return [build(entry) for entry in json.loads(path.read_text())]
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        raise StartFailed(f"Cannot read the eval list {path}: {error!r}") from error


def load_eval_sets(content_dir: Path) -> EvalSets:
    return EvalSets(
        questions=read_list(content_dir, GOLDEN_QUESTIONS_FILE, golden_question),
        scenarios=read_list(content_dir, AGENT_SCENARIOS_FILE, agent_scenario),
        contracts=read_list(content_dir, GROUND_TRUTH_FILE, contract_truth),
        pages=read_list(content_dir, SEED_PAGES_FILE, seed_page_entry),
    )


def check_unique_ids(kind: str, ids: list[str]) -> None:
    duplicates = sorted(item for item, count in Counter(ids).items() if count > 1)
    if duplicates:
        raise StartFailed(f"Duplicate {kind} id: {', '.join(duplicates)}")


def check_titles(owner: str, titles: list[str], seed_titles: set[str]) -> None:
    unknown = [title for title in titles if title not in seed_titles]
    if unknown:
        raise StartFailed(f"{owner} names a page the seed data does not have: {unknown[0]}")


def check_user(owner: str, user: str) -> None:
    if user not in SEED_EMAILS:
        raise StartFailed(f"{owner} names an unknown seed user: {user}")


def check_question(question: GoldenQuestion, seed_titles: set[str]) -> None:
    owner = f"Golden question {question.id}"
    check_user(owner, question.user)
    answering = [question.answered_by] if question.answered_by is not None else []
    check_titles(owner, [*question.expected_pages, *answering], seed_titles)
    if question.expected_pages and question.answered_by not in question.expected_pages:
        raise StartFailed(f"{owner}: the answering page is not one of its expected source pages")


def check_scenario(scenario: AgentScenario, seed_titles: set[str], seed_spaces: set[str]) -> None:
    owner = f"Agent scenario {scenario.id}"
    check_user(owner, scenario.user)
    if scenario.space not in seed_spaces:
        raise StartFailed(f"{owner} names a space the seed data does not have: {scenario.space}")
    check_titles(owner, scenario.expected_proposal_pages, seed_titles)


def check_eval_sets(sets: EvalSets) -> None:
    seed_titles = {page.title for page in sets.pages}
    seed_spaces = {page.space for page in sets.pages}
    attached = {file for page in sets.pages for file in page.attachments}
    check_unique_ids("golden question", [question.id for question in sets.questions])
    for question in sets.questions:
        check_question(question, seed_titles)
    check_unique_ids("agent scenario", [scenario.id for scenario in sets.scenarios])
    for scenario in sets.scenarios:
        check_scenario(scenario, seed_titles, seed_spaces)
    for contract in sets.contracts:
        if contract.pdf not in attached:
            raise StartFailed(f"No seed page has the contract PDF attached: {contract.pdf}")
