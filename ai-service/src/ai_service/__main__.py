from collections.abc import Sequence

import psycopg
import uvicorn
from pydantic import ValidationError
from redis import Redis

from ai_service.app import create_app
from ai_service.ask import AskPipeline, SearchSections
from ai_service.bridge_client import BridgeClient
from ai_service.conversations import ConversationStore
from ai_service.db_check import RoleNotIsolatedError, check_database_role
from ai_service.embedding import Embedder, EmbeddingModelError
from ai_service.index_store import IndexStore, SearchHit
from ai_service.inference import ChatModel
from ai_service.search import search_index
from ai_service.settings import AskSettings
from ai_service.worker import (
    configure_logging,
    describe_settings_error,
    exit_with,
    load_embedder,
)


def load_settings() -> AskSettings:
    return AskSettings()  # pyright: ignore[reportCallIssue]


def index_search(settings: AskSettings, embedder: Embedder) -> SearchSections:
    def search(
        text: str, space_ids: Sequence[str], page_id: str | None, limit: int
    ) -> list[SearchHit]:
        with psycopg.connect(settings.ai_database_url, autocommit=True) as conn:
            return search_index(IndexStore(conn), embedder, text, space_ids, limit, page_id)

    return search


def build_pipeline(settings: AskSettings, embedder: Embedder, redis: Redis) -> AskPipeline:
    bridge = BridgeClient(settings.ai_wiki_url, settings.ai_service_token)
    return AskPipeline(
        search=index_search(settings, embedder),
        filter_pages=bridge.filter_pages,
        model=ChatModel(settings.ai_llm_base_url, settings.ai_llm_model),
        conversations=ConversationStore(redis),
        threshold=settings.ai_relevance_threshold,
        inference_mode=settings.ai_inference_mode,
    )


def main() -> None:
    configure_logging()
    try:
        settings = load_settings()
    except ValidationError as error:
        exit_with(describe_settings_error(error), error)
    try:
        check_database_role(settings.ai_database_url)
    except RoleNotIsolatedError as error:
        exit_with(str(error), error)
    try:
        embedder = load_embedder(settings.ai_embedding_model)
    except EmbeddingModelError as error:
        exit_with(str(error), error)
    redis: Redis = Redis.from_url(settings.redis_url, decode_responses=True)
    uvicorn.run(
        create_app(settings, redis, build_pipeline(settings, embedder, redis)),
        host=settings.ai_service_host,
        port=settings.ai_service_port,
    )


if __name__ == "__main__":
    main()
