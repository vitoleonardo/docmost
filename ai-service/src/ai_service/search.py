from collections.abc import Sequence

from ai_service.embedding import Embedder
from ai_service.index_store import IndexStore, SearchHit

MAX_LIMIT = 50


def search_index(
    store: IndexStore,
    embedder: Embedder,
    question: str,
    space_ids: Sequence[str],
    limit: int = 10,
) -> list[SearchHit]:
    if not 1 <= limit <= MAX_LIMIT:
        raise ValueError(f"limit must be between 1 and {MAX_LIMIT}")
    if not question.strip() or not space_ids:
        return []
    [query_vector] = embedder.embed([question])
    return store.search(query_vector, space_ids, embedder.model_name, limit)
