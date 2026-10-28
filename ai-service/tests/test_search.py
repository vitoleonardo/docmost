from collections.abc import Sequence
from dataclasses import fields

import pytest

from ai_service.index_store import IndexStore, SearchHit, StoredSection
from ai_service.search import search_index
from tests.hashing_embedder import HashingEmbedder
from tests.index_db import (
    SPACE_A,
    SPACE_B,
    SPACE_C,
    attachment_id,
    index_page,
    make_entry,
    page_id,
)

SEARCH_FIELDS = {
    "page_id",
    "title",
    "space_id",
    "heading_path",
    "text",
    "score",
    "attachment_id",
    "file_name",
    "pdf_page",
}


def index_many_sections(store: IndexStore, embedder: HashingEmbedder, count: int) -> None:
    index_page(
        store,
        embedder,
        make_entry(1),
        [f"Urlaub Regel Nummer {number} für das Team" for number in range(count)],
    )


class RefusingStore(IndexStore):
    def __init__(self) -> None:
        pass

    def search(
        self,
        query_vector: Sequence[float],
        space_ids: Sequence[str],
        embedding_model: str,
        limit: int,
    ) -> list[SearchHit]:
        raise AssertionError("the store must not be searched")


@pytest.mark.parametrize("limit", [0, 51, -1])
def test_index_ac72_limit_outside_1_to_50_is_refused_naming_the_range(limit: int):
    embedder = HashingEmbedder()
    with pytest.raises(ValueError, match="limit must be between 1 and 50"):
        search_index(RefusingStore(), embedder, "Urlaub", [SPACE_A], limit=limit)
    with pytest.raises(ValueError, match="limit must be between 1 and 50"):
        search_index(RefusingStore(), embedder, "", [], limit=limit)
    assert embedder.calls == []


@pytest.mark.parametrize("question", ["", "   ", "\n\t "])
def test_index_ac71_empty_or_whitespace_question_returns_nothing_without_embedding(question: str):
    embedder = HashingEmbedder()
    hits = search_index(RefusingStore(), embedder, question, [SPACE_A])
    assert hits == []
    assert embedder.calls == []


def test_index_ac70_empty_space_list_returns_nothing_without_embedding():
    embedder = HashingEmbedder()
    assert search_index(RefusingStore(), embedder, "Urlaub", []) == []
    assert embedder.calls == []


@pytest.mark.integration
def test_index_ac16_results_belong_only_to_pages_of_the_listed_spaces(
    store: IndexStore, embedder: HashingEmbedder
):
    index_page(store, embedder, make_entry(1, space_id=SPACE_A), ["Urlaub im Sommer"])
    index_page(store, embedder, make_entry(2, space_id=SPACE_B), ["Urlaub im Winter"])
    index_page(store, embedder, make_entry(3, space_id=SPACE_C), ["Urlaub im Herbst"])

    hits = search_index(store, embedder, "Urlaub", [SPACE_A, SPACE_B], limit=50)

    assert {hit.page_id for hit in hits} == {page_id(1), page_id(2)}
    assert {hit.space_id for hit in hits} <= {SPACE_A, SPACE_B}
    only_c = search_index(store, embedder, "Urlaub", [SPACE_C])
    assert [hit.page_id for hit in only_c] == [page_id(3)]


@pytest.mark.integration
def test_index_ac16_a_rescoped_page_is_found_in_its_new_space_only(
    store: IndexStore, embedder: HashingEmbedder
):
    index_page(store, embedder, make_entry(1, space_id=SPACE_A), ["Urlaub im Sommer"])
    store.rescope([page_id(1)], SPACE_B)

    assert search_index(store, embedder, "Urlaub", [SPACE_A]) == []
    assert [hit.page_id for hit in search_index(store, embedder, "Urlaub", [SPACE_B])] == [
        page_id(1)
    ]


@pytest.mark.integration
def test_index_ac17_results_hold_the_output_fields_ordered_by_score(
    store: IndexStore, embedder: HashingEmbedder
):
    index_page(
        store,
        embedder,
        make_entry(1, title="Urlaubsregeln"),
        ["Urlaub beantragen", "Urlaub", "Kantine öffnet um acht"],
    )
    [pdf_vector] = embedder.embed(["Urlaub beantragen Formular"])
    store.replace_page(
        make_entry(2, title="Formulare"),
        [
            StoredSection(
                0, [], "Urlaub beantragen Formular", pdf_vector, attachment_id(1), "a.pdf", 2
            )
        ],
    )

    hits = search_index(store, embedder, "Urlaub beantragen", [SPACE_A])

    assert len(hits) == 4
    assert {field.name for field in fields(SearchHit)} == SEARCH_FIELDS
    scores = [hit.score for hit in hits]
    assert scores == sorted(scores, reverse=True)
    assert all(-1.0 <= score <= 1.0 for score in scores)
    assert hits[0].text == "Urlaub beantragen"
    assert hits[0].score == pytest.approx(1.0, abs=1e-5)
    text_hit = hits[0]
    assert (text_hit.page_id, text_hit.title, text_hit.space_id) == (
        page_id(1),
        "Urlaubsregeln",
        SPACE_A,
    )
    assert (text_hit.heading_path, text_hit.attachment_id, text_hit.pdf_page) == ([], None, None)
    [pdf_hit] = [hit for hit in hits if hit.attachment_id is not None]
    assert (pdf_hit.page_id, pdf_hit.title, pdf_hit.file_name, pdf_hit.pdf_page) == (
        page_id(2),
        "Formulare",
        "a.pdf",
        2,
    )
    assert pdf_hit.attachment_id == attachment_id(1)


@pytest.mark.integration
def test_index_ac18_limit_50_returns_50_of_more_sections(
    store: IndexStore, embedder: HashingEmbedder
):
    index_many_sections(store, embedder, 60)
    assert len(search_index(store, embedder, "Urlaub Regel", [SPACE_A], limit=50)) == 50
    assert len(search_index(store, embedder, "Urlaub Regel", [SPACE_A], limit=1)) == 1


@pytest.mark.integration
def test_index_ac19_without_a_limit_returns_10_of_more_sections(
    store: IndexStore, embedder: HashingEmbedder
):
    index_many_sections(store, embedder, 12)
    assert len(search_index(store, embedder, "Urlaub Regel", [SPACE_A])) == 10


@pytest.mark.integration
def test_index_ac20_pages_of_another_model_are_not_returned(
    store: IndexStore, embedder: HashingEmbedder
):
    other = HashingEmbedder(model_name="other-model", dims=64)
    index_page(store, embedder, make_entry(1), ["Urlaub im Sommer"])
    index_page(store, other, make_entry(2, embedding_model=other.model_name), ["Urlaub im Winter"])

    hits = search_index(store, embedder, "Urlaub", [SPACE_A])
    assert [hit.page_id for hit in hits] == [page_id(1)]
    other_hits = search_index(store, other, "Urlaub", [SPACE_A])
    assert [hit.page_id for hit in other_hits] == [page_id(2)]


@pytest.mark.integration
def test_index_ac70_empty_space_list_on_a_filled_index_returns_nothing(
    store: IndexStore, embedder: HashingEmbedder
):
    index_page(store, embedder, make_entry(1), ["Urlaub im Sommer"])
    assert search_index(store, embedder, "Urlaub", []) == []
    assert search_index(store, embedder, "   ", [SPACE_A]) == []
