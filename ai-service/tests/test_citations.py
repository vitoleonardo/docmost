import pytest

from ai_service.citations import CitationFilter


def run(source_count: int, deltas: list[str]) -> tuple[str, list[int]]:
    citation_filter = CitationFilter(source_count)
    shown = "".join(citation_filter.feed(delta) for delta in deltas)
    shown += citation_filter.finish()
    return shown, citation_filter.cited()


def test_ask_ac16_renumbers_in_order_of_first_appearance() -> None:
    shown, cited = run(3, ["Erst [3], dann [1]."])
    assert shown == "Erst [1], dann [2]."
    assert cited == [3, 1]


def test_ask_ac15_repeated_citation_reuses_its_number() -> None:
    shown, cited = run(3, ["A [3] B [1] C [3]."])
    assert shown == "A [1] B [2] C [1]."
    assert cited == [3, 1]


@pytest.mark.parametrize("marker", ["[3, 1]", "[3,1]", "[3,  1]"])
def test_ask_ac16_list_marker_becomes_adjacent_markers(marker: str) -> None:
    shown, cited = run(3, [f"Satz {marker}."])
    assert shown == "Satz [1][2]."
    assert cited == [3, 1]


@pytest.mark.parametrize(
    "deltas",
    [
        ["Erstattet [", "1", "2]."],
        ["Erstattet [12", "]."],
        ["Erstattet [1", "2", "]", "."],
        ["Erstattet ", "[", "12", "]", "."],
        list("Erstattet [12]."),
    ],
)
def test_ask_ac16_marker_split_across_deltas(deltas: list[str]) -> None:
    shown, cited = run(12, deltas)
    assert shown == "Erstattet [1]."
    assert cited == [12]


def test_ask_ac16_held_back_marker_is_not_shown_early() -> None:
    citation_filter = CitationFilter(3)
    assert citation_filter.feed("Text [") == "Text "
    assert citation_filter.feed("3") == ""
    assert citation_filter.feed("]") == "[1]"


def test_ask_ac24_invalid_numbers_are_removed() -> None:
    shown, cited = run(2, ["A [0] B [3] C [2]."])
    assert shown == "A  B  C [1]."
    assert cited == [2]


def test_ask_ac24_mixed_list_keeps_the_valid_number() -> None:
    shown, cited = run(2, ["A [5, 2, 0]."])
    assert shown == "A [1]."
    assert cited == [2]


def test_ask_ac16_brackets_that_are_not_markers_pass_through() -> None:
    text = "Siehe [Hinweis], [ ], [1a] und [] sowie [1, x]."
    shown, cited = run(3, [text])
    assert shown == text
    assert cited == []


def test_ask_ac16_non_marker_bracket_split_across_deltas_passes_through() -> None:
    shown, cited = run(3, ["Siehe [", "Hin", "weis] ok"])
    assert shown == "Siehe [Hinweis] ok"
    assert cited == []


def test_ask_ac16_long_unterminated_bracket_is_released() -> None:
    citation_filter = CitationFilter(3)
    text = "[" + "1, " * 10
    shown = citation_filter.feed(text)
    assert shown == text
    assert citation_filter.finish() == ""


def test_ask_ac16_finish_flushes_unclosed_marker_as_text() -> None:
    citation_filter = CitationFilter(3)
    shown = citation_filter.feed("Ende [1")
    shown += citation_filter.finish()
    assert shown == "Ende [1"
    assert citation_filter.cited() == []


def test_ask_ac25_no_citation_leaves_cited_empty() -> None:
    shown, cited = run(3, ["Keine Quelle genannt."])
    assert shown == "Keine Quelle genannt."
    assert cited == []


def test_ask_ac25_only_invalid_citations_leave_cited_empty() -> None:
    shown, cited = run(2, ["Nur [7]."])
    assert shown == "Nur ."
    assert cited == []
