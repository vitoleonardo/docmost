from collections.abc import Iterator, Sequence
from contextlib import contextmanager

import psycopg
import uvicorn
from pydantic import ValidationError
from redis import Redis

from ai_service.agent import AgentRunner
from ai_service.agent_store import AgentStore
from ai_service.app import AgentRecords, AgentServices, create_app
from ai_service.ask import AskPipeline, SearchSections
from ai_service.bridge_client import BridgeClient
from ai_service.conversations import ConversationStore
from ai_service.db_check import RoleNotIsolatedError, check_database_role
from ai_service.embedding import Embedder, EmbeddingModelError
from ai_service.extraction import ExtractionPipeline
from ai_service.index_store import IndexStore, SearchHit
from ai_service.inference import ChatModel
from ai_service.request_log import RequestLog
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


def build_request_log(settings: AskSettings) -> RequestLog:
    return RequestLog(
        settings.ai_database_url,
        settings.ai_request_log_secret,
        settings.ai_inference_mode,
        settings.ai_llm_model,
    )


def build_pipeline(
    settings: AskSettings, embedder: Embedder, redis: Redis, request_log: RequestLog
) -> AskPipeline:
    bridge = BridgeClient(settings.ai_wiki_url, settings.ai_service_token)
    return AskPipeline(
        search=index_search(settings, embedder),
        filter_pages=bridge.filter_pages,
        model=ChatModel(settings.ai_llm_base_url, settings.ai_llm_model),
        conversations=ConversationStore(redis),
        threshold=settings.ai_relevance_threshold,
        inference_mode=settings.ai_inference_mode,
        request_log=request_log,
    )


def build_extraction_pipeline(settings: AskSettings, request_log: RequestLog) -> ExtractionPipeline:
    bridge = BridgeClient(settings.ai_wiki_url, settings.ai_service_token)
    return ExtractionPipeline(
        fetch_attachment=bridge.attachment,
        model=ChatModel(settings.ai_llm_base_url, settings.ai_llm_model),
        mode=settings.ai_inference_mode,
        model_name=settings.ai_llm_model,
        request_log=request_log,
    )


def build_agent_services(settings: AskSettings, request_log: RequestLog) -> AgentServices:
    bridge = BridgeClient(settings.ai_wiki_url, settings.ai_service_token)
    model = ChatModel(settings.ai_llm_base_url, settings.ai_llm_model)

    @contextmanager
    def open_records() -> Iterator[AgentStore]:
        with psycopg.connect(settings.ai_database_url, autocommit=True) as conn:
            yield AgentStore(conn)

    def make_runner(records: AgentRecords) -> AgentRunner:
        return AgentRunner(
            model=model,
            bridge=bridge,
            store=records,
            inference_mode=settings.ai_inference_mode,
            model_name=settings.ai_llm_model,
            request_log=request_log,
        )

    return AgentServices(open_records=open_records, make_runner=make_runner)


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
    request_log = build_request_log(settings)
    uvicorn.run(
        create_app(
            settings,
            redis,
            build_pipeline(settings, embedder, redis, request_log),
            build_extraction_pipeline(settings, request_log),
            build_agent_services(settings, request_log),
        ),
        host=settings.ai_service_host,
        port=settings.ai_service_port,
    )


if __name__ == "__main__":
    main()
