import uuid
from collections.abc import Sequence

from ai_service.embedding import Embedder
from ai_service.index_store import IndexStore, SearchHit

MAX_LIMIT = 50


def is_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
    except ValueError:
        return False
    return True


def search_index(
    store: IndexStore,
    embedder: Embedder,
    question: str,
    space_ids: Sequence[str],
    limit: int = 10,
    page_id: str | None = None,
) -> list[SearchHit]:
    if not 1 <= limit <= MAX_LIMIT:
        raise ValueError(f"limit must be between 1 and {MAX_LIMIT}")
    if not all(is_uuid(space_id) for space_id in space_ids):
        raise ValueError("space_ids must hold UUIDs only")
    if page_id is not None and not is_uuid(page_id):
        raise ValueError("page_id must be a UUID")
    if not question.strip() or not space_ids:
        return []
    [query_vector] = embedder.embed([question])
    return store.search(query_vector, space_ids, embedder.model_name, limit, page_id)
