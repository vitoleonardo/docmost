import json
import re
from collections import Counter
from dataclasses import replace
from functools import cache
from pathlib import Path

import pytest

from ai_service.eval_sets import (
    AgentScenario,
    ContractTruth,
    EvalSets,
    FieldTruth,
    GoldenQuestion,
    SeedPageEntry,
    check_eval_sets,
    load_eval_sets,
)
from ai_service.extraction import normalise
from ai_service.sections import read_pdf_pages
from ai_service.wiki_session import StartFailed
from tests.seed_matrix import (
    LEAK_QUESTIONS_PATH,
    SEED_CONTENT,
    SEED_USERS,
    SPACE_DIRS,
    SPACE_MEMBERS,
    SeedPage,
    load_entries,
    load_seed_pages,
    seed_id,
    sentences_of,
)

GENERATED_DIR = SEED_CONTENT / "generated"
ISSUES = json.loads((SEED_CONTENT / "issues.json").read_text())
RAW_LISTS = [
    load_entries(SEED_CONTENT / "golden-questions.json"),
    load_entries(SEED_CONTENT / "agent-scenarios.json"),
]
SETS = load_eval_sets(SEED_CONTENT)
ENTRIES_BY_TITLE = {entry.title: entry for entry in SETS.pages}
SPACE_DIR_OF = {entry.space: entry.file.split("/")[0] for entry in SETS.pages}
SEED_PAGES_BY_ID = {page.page_id: page for page in load_seed_pages()}
WITH_PAGES = [question for question in SETS.questions if question.expected_pages]
WITHOUT_PAGES = [question for question in SETS.questions if not question.expected_pages]
CONTRACT_PDFS = {contract.pdf for contract in SETS.contracts}
AGENT_OUTCOMES = {"finished", "out_of_scope"}
EDIT_ROLES = ("writer", "admin")

SPACE_ROLES: dict[str, dict[str, str]] = {
    "GF": dict.fromkeys(SPACE_DIRS, "admin"),
    "PL": {"allgemein": "writer", "hr": "reader", "projekte": "admin", "it": "reader"},
    "VT": {"allgemein": "writer", "vertrieb": "writer", "projekte": "reader"},
    "WS": {"allgemein": "reader", "projekte": "writer", "it": "reader"},
}
RESTRICTED_EDITORS: dict[str, frozenset[str]] = {
    "Umstrukturierung 2027": frozenset({"GF"}),
    "Angebot Kalkulation Kläranlage Nordhafen": frozenset({"GF", "PL"}),
    "Baustelle Nordhafen intern": frozenset({"GF", "PL"}),
    "Baustelle Nordhafen Zugangscodes": frozenset({"GF", "PL"}),
}


def seed_page(title: str) -> SeedPage:
    entry = ENTRIES_BY_TITLE[title]
    return SEED_PAGES_BY_ID[seed_id(f"page:{entry.file.removesuffix('.md')}")]


def may_view(user: str, title: str) -> bool:
    return seed_page(title).viewable_by(user)


def may_edit(user: str, title: str) -> bool:
    if not may_view(user, title):
        return False
    if title in RESTRICTED_EDITORS:
        return user in RESTRICTED_EDITORS[title]
    return SPACE_ROLES[user].get(seed_page(title).space_dir) in EDIT_ROLES


def role_in(user: str, space: str) -> str | None:
    return SPACE_ROLES[user].get(SPACE_DIR_OF[space])


@cache
def pdf_text(file_name: str) -> str:
    return normalise(" ".join(read_pdf_pages((GENERATED_DIR / file_name).read_bytes())))


def page_text(title: str) -> str:
    return normalise(seed_page(title).markdown)


def in_any_page(fact: str) -> bool:
    return any(fact in normalise(page.markdown) for page in SEED_PAGES_BY_ID.values())


def in_expected_page(question: GoldenQuestion) -> bool:
    fact = normalise(question.key_fact or "")
    return any(fact in page_text(title) for title in question.expected_pages)


def in_attached_pdf(question: GoldenQuestion, files: set[str] | None = None) -> bool:
    fact = normalise(question.key_fact or "")
    return any(
        fact in pdf_text(file)
        for title in question.expected_pages
        for file in ENTRIES_BY_TITLE[title].attachments
        if files is None or file in files
    )


def pdf_only(question: GoldenQuestion) -> bool:
    return not in_expected_page(question) and in_attached_pdf(question)


def answering_page_hidden_from_asker(question: GoldenQuestion) -> bool:
    return question.answered_by is not None and not may_view(question.user, question.answered_by)


def test_eval_ac1_the_golden_list_has_20_entries_with_unique_ids():
    ids = [question.id for question in SETS.questions]
    assert len(ids) == 20
    assert len(set(ids)) == 20
    assert all(re.fullmatch(r"rag-\d{2}", question_id) for question_id in ids), ids


def test_eval_ac1_at_least_14_questions_have_pages_and_at_least_5_have_none():
    assert len(WITH_PAGES) >= 14
    assert len(WITHOUT_PAGES) >= 5


def test_eval_ac1_every_asker_is_a_seed_user_and_every_question_is_unique():
    assert SETS.questions
    assert all(question.user in SEED_USERS for question in SETS.questions)
    texts = Counter(question.question for question in SETS.questions)
    assert [text for text, count in texts.items() if count > 1] == []


def test_eval_ac1_questions_with_pages_have_a_reference_a_key_fact_and_answer_among_them():
    assert WITH_PAGES
    for question in WITH_PAGES:
        assert question.reference_answer, question.id
        assert question.key_fact, question.id
        assert question.answered_by in question.expected_pages, question.id


def test_eval_ac1_questions_without_pages_have_no_reference_answer_and_no_key_fact():
    assert WITHOUT_PAGES
    for question in WITHOUT_PAGES:
        assert question.reference_answer is None, question.id
        assert question.key_fact is None, question.id


def test_eval_ac1_every_answering_page_is_a_seed_page():
    assert SETS.questions
    for question in SETS.questions:
        assert question.answered_by is None or question.answered_by in ENTRIES_BY_TITLE, question.id


def test_eval_ac1_no_golden_question_and_no_agent_scenario_holds_a_canary_string():
    entries = [entry for entries in RAW_LISTS for entry in entries]
    assert entries
    for entry in entries:
        assert "CANARY-" not in json.dumps(entry, ensure_ascii=False), entry["id"]


def test_eval_ac2_each_contradiction_pair_has_a_question_expecting_only_the_current_page():
    assert ISSUES["contradictions"]
    for pair in ISSUES["contradictions"]:
        current = pair["current"]
        matching = [
            question
            for question in SETS.questions
            if question.expected_pages == [current["title"]]
            and question.key_fact == current["value"]
        ]
        assert len(matching) == 1, pair["fact"]


def test_eval_ac3_the_access_rules_follow_the_space_and_page_matrices():
    assert {user: frozenset(roles) for user, roles in SPACE_ROLES.items()} == SPACE_MEMBERS
    assert may_view("WS", "Baustelle Nordhafen intern")
    assert not may_edit("WS", "Baustelle Nordhafen intern")
    assert not may_view("VT", "Baustelle Nordhafen Zugangscodes")
    assert not may_view("PL", "Umstrukturierung 2027")
    assert may_edit("PL", "Reisekosten Richtlinie 2022")
    assert not may_edit("PL", "VPN Einrichtung Classic")
    assert may_edit("GF", "Willkommen bei Ostmooimooi")
    assert may_edit("GF", "Angebot Kalkulation Kläranlage Nordhafen")
    assert not may_edit("VT", "Angebot Kalkulation Kläranlage Nordhafen")
    assert not may_edit("PL", "Umstrukturierung 2027")


def test_eval_ac3_every_expected_page_is_a_seed_page_the_asker_may_view():
    assert WITH_PAGES
    for question in WITH_PAGES:
        for title in question.expected_pages:
            assert title in ENTRIES_BY_TITLE, (question.id, title)
            assert may_view(question.user, title), (question.id, question.user, title)


def test_eval_ac4_every_key_fact_occurs_in_an_expected_page_or_a_pdf_attached_to_one():
    assert WITH_PAGES
    for question in WITH_PAGES:
        assert in_expected_page(question) or in_attached_pdf(question), question.id


def test_eval_ac4_a_key_fact_found_only_in_an_attached_pdf_occurs_in_no_seed_page():
    for question in filter(pdf_only, WITH_PAGES):
        assert not in_any_page(normalise(question.key_fact or "")), question.id


def test_eval_ac4_one_question_is_answered_only_from_a_contract_pdf_of_its_only_expected_page():
    assert any(
        len(question.expected_pages) == 1
        and pdf_only(question)
        and in_attached_pdf(question, CONTRACT_PDFS)
        and not in_any_page(normalise(question.key_fact or ""))
        for question in WITH_PAGES
    )


def test_eval_ac4_the_pdf_text_helper_reads_the_text_layer_of_a_seed_contract():
    assert "1.200.000,00 € netto" in pdf_text("kundenvertrag-stadtwerke-beispielstadt.pdf")
    assert pdf_text("wartungsvertrag-serverraum-scan.pdf") == ""


def test_eval_ac5_at_least_two_questions_without_pages_name_a_page_their_asker_may_not_view():
    assert len([q for q in WITHOUT_PAGES if answering_page_hidden_from_asker(q)]) >= 2


def test_eval_ac5_at_least_two_questions_without_pages_name_no_page():
    assert len([q for q in WITHOUT_PAGES if q.answered_by is None]) >= 2


def test_eval_ac5_a_named_page_of_a_question_without_pages_is_hidden_and_not_copied():
    named = [question for question in WITHOUT_PAGES if question.answered_by is not None]
    assert named
    for question in named:
        assert question.answered_by is not None
        assert answering_page_hidden_from_asker(question), question.id
        sentences = sentences_of(seed_page(question.answered_by).markdown)
        assert not any(sentence in question.question for sentence in sentences), question.id


def test_eval_ac6_the_scenario_list_has_unique_ids():
    ids = [scenario.id for scenario in SETS.scenarios]
    assert ids
    assert len(set(ids)) == len(ids)
    assert all(re.fullmatch(r"agent-\d{2}", scenario_id) for scenario_id in ids), ids


def test_eval_ac6_every_scenario_user_is_a_seed_user_and_member_of_the_space():
    assert SETS.scenarios
    for scenario in SETS.scenarios:
        assert scenario.user in SEED_USERS, scenario.id
        assert scenario.space in SPACE_DIR_OF, scenario.id
        assert SPACE_DIR_OF[scenario.space] in SPACE_MEMBERS[scenario.user], scenario.id


def test_eval_ac6_expected_outcomes_are_known_and_proposal_pages_lie_in_the_space():
    assert SETS.scenarios
    for scenario in SETS.scenarios:
        assert scenario.expected_outcomes, scenario.id
        assert set(scenario.expected_outcomes) <= AGENT_OUTCOMES, scenario.id
        assert scenario.task.strip(), scenario.id
        for title in scenario.expected_proposal_pages:
            assert ENTRIES_BY_TITLE[title].space == scenario.space, (scenario.id, title)


def test_eval_ac6_every_outdated_page_has_a_scenario_by_a_user_who_may_edit_it():
    assert ISSUES["outdated"]
    for outdated in ISSUES["outdated"]:
        assert any(
            scenario.space == outdated["space"]
            and scenario.expected_outcomes == ["finished"]
            and scenario.expected_proposal_pages == [outdated["title"]]
            and may_edit(scenario.user, outdated["title"])
            for scenario in SETS.scenarios
        ), outdated["title"]


def test_eval_ac6_one_scenario_user_may_only_view_the_space_and_expects_an_outdated_page():
    outdated = {(entry["space"], entry["title"]) for entry in ISSUES["outdated"]}
    assert any(
        role_in(scenario.user, scenario.space) == "reader"
        and scenario.expected_outcomes == ["finished"]
        and len(scenario.expected_proposal_pages) == 1
        and (scenario.space, scenario.expected_proposal_pages[0]) in outdated
        for scenario in SETS.scenarios
    )


@pytest.mark.parametrize(
    "outcomes", [["out_of_scope"], ["finished", "out_of_scope"]], ids=["no_search", "search"]
)
def test_eval_ac6_a_task_outside_the_tools_expects_no_proposal(outcomes: list[str]):
    assert any(
        sorted(scenario.expected_outcomes) == outcomes and scenario.expected_proposal_pages == []
        for scenario in SETS.scenarios
    )


def test_eval_ac7_every_golden_question_is_in_the_leak_list_without_a_page():
    leak_questions = {
        entry["question"]
        for entry in load_entries(LEAK_QUESTIONS_PATH)
        if entry["pageTitle"] is None
    }
    assert SETS.questions
    for question in SETS.questions:
        assert question.question in leak_questions, question.id


PAGE = SeedPageEntry(
    space="Vertrieb",
    title="Kundenvertrag",
    file="vertrieb/kundenvertrag.md",
    attachments=["kundenvertrag.pdf"],
    viewers=frozenset({"VT", "GF"}),
)
QUESTION = GoldenQuestion(
    id="rag-01",
    user="VT",
    question="Wie hoch ist der Auftragswert?",
    expected_pages=["Kundenvertrag"],
    answered_by="Kundenvertrag",
    reference_answer="Der Auftragswert beträgt 1,2 Mio. € netto.",
    key_fact="1,2 Mio. €",
)
SCENARIO = AgentScenario(
    id="agent-01",
    user="VT",
    space="Vertrieb",
    task="Finde veraltete Seiten zu Verträgen und schlage Updates vor",
    expected_outcomes=["finished"],
    expected_proposal_pages=["Kundenvertrag"],
)
CONTRACT = ContractTruth(
    pdf="kundenvertrag.pdf",
    text_layer=True,
    fields={"value": FieldTruth(value="1,2 Mio. €", quote="Wert 1,2 Mio. €.", pdf_page=1)},
)
MINIMAL = EvalSets(questions=[QUESTION], scenarios=[SCENARIO], contracts=[CONTRACT], pages=[PAGE])


def test_eval_ac60_the_shipped_sets_and_a_minimal_set_pass_the_start_check():
    check_eval_sets(SETS)
    check_eval_sets(MINIMAL)


def test_eval_ac60_the_loaded_ground_truth_keeps_values_and_missing_fields():
    truth = {contract.pdf: contract for contract in SETS.contracts}
    assert len(truth) == 7
    stadtwerke = truth["kundenvertrag-stadtwerke-beispielstadt.pdf"].fields["value"]
    assert stadtwerke == FieldTruth("1.200.000,00 € netto", stadtwerke.quote, 1)
    assert truth["subunternehmervertrag-tiefbau.pdf"].fields["renewal"].missing
    assert not truth["wartungsvertrag-serverraum-scan.pdf"].text_layer


@pytest.mark.parametrize(
    ("questions", "named"),
    [
        ([QUESTION, replace(QUESTION, question="Noch einmal?")], "rag-01"),
        ([replace(QUESTION, id="rag-07", expected_pages=["Preisliste 1999"])], "rag-07"),
        ([replace(QUESTION, id="rag-08", answered_by="Preisliste 1999")], "rag-08"),
        (
            [replace(QUESTION, id="rag-09", expected_pages=[], answered_by="Preisliste 1999")],
            "rag-09",
        ),
        ([replace(QUESTION, id="rag-10", answered_by=None)], "rag-10"),
        ([replace(QUESTION, id="rag-11", user="XY")], "rag-11"),
    ],
    ids=[
        "duplicate_id",
        "unknown_expected_page",
        "unknown_answering_page",
        "unknown_answering_page_without_sources",
        "answering_page_not_expected",
        "unknown_asker",
    ],
)
def test_eval_ac60_a_broken_golden_question_fails_the_start_naming_its_id(
    questions: list[GoldenQuestion], named: str
):
    with pytest.raises(StartFailed, match=named):
        check_eval_sets(replace(MINIMAL, questions=questions))


@pytest.mark.parametrize(
    ("scenarios", "named"),
    [
        ([SCENARIO, replace(SCENARIO, task="Noch einmal")], "agent-01"),
        ([replace(SCENARIO, id="agent-04", space="Einkauf")], "agent-04"),
        (
            [replace(SCENARIO, id="agent-05", expected_proposal_pages=["Preisliste 1999"])],
            "agent-05",
        ),
        ([replace(SCENARIO, id="agent-06", user="XY")], "agent-06"),
    ],
    ids=["duplicate_id", "unknown_space", "unknown_proposal_page", "unknown_user"],
)
def test_eval_ac61_a_broken_agent_scenario_fails_the_start_naming_its_id(
    scenarios: list[AgentScenario], named: str
):
    with pytest.raises(StartFailed, match=named):
        check_eval_sets(replace(MINIMAL, scenarios=scenarios))


def test_eval_ac62_a_contract_pdf_no_seed_page_attaches_fails_the_start_naming_the_file():
    sets = replace(MINIMAL, pages=[replace(PAGE, attachments=[])])
    with pytest.raises(StartFailed, match=re.escape("kundenvertrag.pdf")):
        check_eval_sets(sets)


def test_eval_ac60_a_missing_or_malformed_list_fails_the_start_naming_the_file(tmp_path: Path):
    (tmp_path / "generated").mkdir()
    for name in ("generated/ground-truth.json", "generated/pages.json", "agent-scenarios.json"):
        (tmp_path / name).write_text("[]")
    with pytest.raises(StartFailed, match="golden-questions.json"):
        load_eval_sets(tmp_path)
    (tmp_path / "golden-questions.json").write_text('[{"id": "rag-01"}]')
    with pytest.raises(StartFailed, match="golden-questions.json"):
        load_eval_sets(tmp_path)


def test_eval_ac60_an_asker_who_may_not_view_an_expected_page_fails_the_start_naming_the_question():
    page = replace(PAGE, viewers=frozenset({"GF"}))
    sets = replace(MINIMAL, pages=[page])
    with pytest.raises(StartFailed, match="rag-01.*VT.*Kundenvertrag"):
        check_eval_sets(sets)


def test_eval_ac60_the_pages_json_viewers_agree_with_the_seed_matrix():
    seed_pages = {page.page_id: page for page in load_seed_pages()}
    assert len(SETS.pages) == len(seed_pages)
    for entry in SETS.pages:
        matrix_page = seed_pages[seed_id(f"page:{entry.file.removesuffix('.md')}")]
        expected = {user for user in SEED_USERS if matrix_page.viewable_by(user)}
        assert entry.viewers == expected, entry.title
