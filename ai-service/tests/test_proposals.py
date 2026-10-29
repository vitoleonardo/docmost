import time
from typing import Any

import pytest

from ai_service.proposals import (
    Block,
    PageRead,
    ProposalDraft,
    ProposalRefused,
    build_proposal,
    diff_words,
)


def make_read(page_id: str = "p1", texts: list[str] | None = None) -> PageRead:
    texts = texts or [f"Text {n}" for n in range(1, 7)]
    blocks = tuple(
        Block(number=n, text=text, heading="Kopf", editable=True)
        for n, text in enumerate(texts, start=1)
    )
    return PageRead(page_id=page_id, title="Seite", fingerprint="fp", blocks=blocks)


def propose(
    changes: list[Any],
    reason: str = "Grund",
    page_id: str = "p1",
    read: PageRead | None = None,
    already_proposed: frozenset[str] = frozenset(),
    reads: dict[str, PageRead] | None = None,
) -> ProposalDraft:
    if reads is None:
        reads = {"p1": read or make_read()}
    return build_proposal(page_id, reason, changes, reads, already_proposed)


def refusal(**kwargs: Any) -> str:
    with pytest.raises(ProposalRefused) as caught:
        propose(**kwargs)
    return caught.value.reason


def rebuild(ops: tuple, kinds: set[str]) -> str:
    return "".join(op.text for op in ops if op.op in kinds)


def test_agent_ac72_marks_only_the_changed_number() -> None:
    ops = diff_words("0,30 € pro Kilometer", "0,38 € pro Kilometer")
    assert [(op.op, op.text) for op in ops] == [
        ("remove", "0,30"),
        ("add", "0,38"),
        ("keep", " € pro Kilometer"),
    ]


def test_agent_ac51_counts_added_and_removed_words_over_all_changes() -> None:
    read = make_read(texts=["Es gelten von 28 Arbeitstagen", "Stand: März 2024.", "x"])
    draft = propose(
        [
            {"block": 1, "newText": "Es gelten von 30 Arbeitstagen"},
            {"block": 2, "newText": "Stand: Oktober 2026."},
        ],
        read=read,
    )
    assert (draft.added, draft.removed) == (3, 3)


def test_agent_ac38_accepted_change_holds_old_text_of_the_read_and_new_text() -> None:
    draft = propose([{"block": 3, "newText": "Neu 3"}], reason="Veraltet")
    assert draft.page_id == "p1"
    assert draft.page_title == "Seite"
    assert draft.fingerprint == "fp"
    assert draft.reason == "Veraltet"
    change = draft.changes[0]
    assert (change.block, change.heading) == (3, "Kopf")
    assert (change.old_text, change.new_text) == ("Text 3", "Neu 3")


def test_agent_ac38_json_form_has_the_stored_shape() -> None:
    draft = propose([{"block": 1, "newText": "Text eins"}])
    assert draft.to_json()["changes"][0]["ops"] == [
        {"op": "keep", "text": "Text "},
        {"op": "remove", "text": "1"},
        {"op": "add", "text": "eins"},
    ]


def test_agent_ac38_new_text_is_kept_as_given() -> None:
    draft = propose([{"block": 1, "newText": "  Text   eins "}])
    assert draft.changes[0].new_text == "  Text   eins "


def test_agent_ac39_refuses_a_page_that_was_not_read() -> None:
    assert refusal(changes=[{"block": 1, "newText": "x y"}], page_id="other")


def test_agent_ac40_refuses_a_block_number_not_in_the_read() -> None:
    reason = refusal(changes=[{"block": 7, "newText": "x y"}])
    assert "7" in reason


@pytest.mark.parametrize(
    "new_text",
    ["Text 1", "  Text   1\n", "", "   ", "a" * 2001],
)
def test_agent_ac41_refuses_unusable_new_texts(new_text: str) -> None:
    assert refusal(changes=[{"block": 1, "newText": new_text}])


def test_agent_ac41_accepts_2000_characters() -> None:
    draft = propose([{"block": 1, "newText": "a" * 2000}])
    assert len(draft.changes[0].new_text) == 2000


@pytest.mark.parametrize("raw_block", ["1", 1.0, True, None])
def test_agent_ac40_refuses_a_block_that_is_not_an_int(raw_block: Any) -> None:
    assert refusal(changes=[{"block": raw_block, "newText": "x y"}])


@pytest.mark.parametrize("raw_text", [5, None, ["a"]])
def test_agent_ac41_refuses_a_new_text_that_is_not_a_string(raw_text: Any) -> None:
    assert refusal(changes=[{"block": 1, "newText": raw_text}])


@pytest.mark.parametrize("raw_change", ["x", 3, None, {"block": 1}])
def test_agent_ac41_refuses_malformed_changes(raw_change: Any) -> None:
    assert refusal(changes=[raw_change])


def test_agent_ac44_refuses_changes_that_are_not_a_list() -> None:
    assert refusal(changes="nope")


@pytest.mark.parametrize("reason", ["", "   \n", "g" * 501])
def test_agent_ac42_refuses_unusable_reasons(reason: str) -> None:
    assert refusal(changes=[{"block": 1, "newText": "x y"}], reason=reason)


def test_agent_ac42_refuses_a_reason_that_is_not_a_string() -> None:
    assert refusal(changes=[{"block": 1, "newText": "x y"}], reason=None)


def test_agent_ac42_accepts_500_characters() -> None:
    draft = propose([{"block": 1, "newText": "x y"}], reason="g" * 500)
    assert len(draft.reason) == 500


def test_agent_ac43_refuses_two_changes_to_one_block() -> None:
    assert refusal(changes=[{"block": 2, "newText": "a b"}, {"block": 2, "newText": "c d"}])


def test_agent_ac44_refuses_11_changes_and_no_changes() -> None:
    read = make_read(texts=[f"alt {n}" for n in range(11)])
    eleven = [{"block": n, "newText": f"neu {n}"} for n in range(1, 12)]
    assert refusal(changes=eleven, read=read)
    assert refusal(changes=[], read=read)


def test_agent_ac44_accepts_10_changes() -> None:
    read = make_read(texts=[f"alt {n}" for n in range(11)])
    ten = [{"block": n, "newText": f"neu {n}"} for n in range(1, 11)]
    assert len(propose(ten, read=read).changes) == 10


def test_agent_ac45_refuses_a_block_that_is_not_editable() -> None:
    read = PageRead(
        page_id="p1",
        title="Seite",
        fingerprint="fp",
        blocks=(Block(number=1, text="Hallo @Anna", heading=None, editable=False),),
    )
    assert refusal(changes=[{"block": 1, "newText": "Hallo Bernd"}], read=read)


def test_agent_ac46_refuses_a_second_proposal_for_a_page() -> None:
    assert refusal(changes=[{"block": 1, "newText": "x y"}], already_proposed=frozenset({"p1"}))


def test_agent_ac46_uses_the_most_recent_read_passed_in() -> None:
    newer = make_read(texts=["Ganz neu"])
    draft = propose([{"block": 1, "newText": "Ganz anders"}], read=newer)
    assert draft.changes[0].old_text == "Ganz neu"
    assert refusal(changes=[{"block": 2, "newText": "a b"}], read=newer)


PAIRS = [
    ("", ""),
    ("a", ""),
    ("", "b c"),
    ("a b c", "a b c"),
    ("  führend  und\tTab\nZeile ", "führend und Tab Zeile"),
    ("alt alt neu alt", "alt neu neu alt alt"),
    ("Kilometerpauschale 0,30 € gilt", "Gilt Kilometerpauschale 0,38 €"),
    ("x " * 40, "y " * 30 + "x " * 5),
]


@pytest.mark.parametrize(("old", "new"), PAIRS)
def test_agent_ac72_ops_rebuild_old_and_new_text_exactly(old: str, new: str) -> None:
    ops = diff_words(old, new)
    assert rebuild(ops, {"keep", "remove"}) == old
    assert rebuild(ops, {"keep", "add"}) == new


def test_agent_ac72_adjacent_ops_of_one_kind_are_merged() -> None:
    ops = diff_words("a b c d", "a x y d")
    kinds = [op.op for op in ops]
    assert all(left != right for left, right in zip(kinds, kinds[1:], strict=False))
    assert kinds == ["keep", "remove", "add", "keep"]


def test_agent_ac72_removed_text_comes_before_added_text() -> None:
    ops = diff_words("eins zwei drei", "eins vier drei")
    assert [op.op for op in ops] == ["keep", "remove", "add", "keep"]


def test_agent_ac72_marks_the_fewest_words() -> None:
    ops = diff_words("a b c d e f", "x a b c d e f")
    marked = [op for op in ops if op.op != "keep"]
    assert [(op.op, op.text.strip()) for op in marked] == [("add", "x")]


def test_agent_ac72_finds_a_minimal_edit_where_greedy_matching_is_longer() -> None:
    ops = diff_words("a b c d e", "b c d e a")
    changed = [token for op in ops if op.op != "keep" for token in op.text.split()]
    assert len(changed) == 2


def test_agent_ac72_diffs_2000_characters_quickly() -> None:
    old = " ".join(f"w{n}" for n in range(400))[:2000]
    new = " ".join(f"v{n}" if n % 2 else f"w{n}" for n in range(400))[:2000]
    started = time.monotonic()
    ops = diff_words(old, new)
    assert time.monotonic() - started < 1.0
    assert rebuild(ops, {"keep", "remove"}) == old
    assert rebuild(ops, {"keep", "add"}) == new
