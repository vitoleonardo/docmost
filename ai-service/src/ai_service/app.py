import json
import logging
from collections.abc import AsyncIterator, Callable, Coroutine, Generator
from typing import Annotated, Any, Self
from uuid import UUID

from fastapi import Depends, FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from redis import Redis
from starlette.concurrency import iterate_in_threadpool, run_in_threadpool

from ai_service.ask import AskPipeline, AskRequest, Event
from ai_service.auth import (
    ERROR_STATUS,
    ApiError,
    UserSession,
    require_service_token,
    require_user_session,
)
from ai_service.bridge_client import AttachmentNotFound, BridgeError
from ai_service.conversations import ConversationStore
from ai_service.extraction import ExtractionPipeline
from ai_service.jobs import enqueue_job
from ai_service.settings import Settings

LOGGER = logging.getLogger("ai_service.app")
MAX_QUESTION_LENGTH = 2000


class JobRequest(BaseModel):
    name: str = Field(min_length=1)
    data: dict[str, Any]


class AskBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_QUESTION_LENGTH),
    ]
    conversationId: UUID
    spaceId: UUID | None = None
    pageId: UUID | None = None

    @model_validator(mode="after")
    def at_most_one_scope(self) -> Self:
        if self.spaceId is not None and self.pageId is not None:
            raise ValueError("spaceId and pageId exclude each other")
        return self

    def to_request(self) -> AskRequest:
        return AskRequest(
            question=self.question,
            conversation_id=str(self.conversationId),
            space_id=None if self.spaceId is None else str(self.spaceId),
            page_id=None if self.pageId is None else str(self.pageId),
        )


class ConfirmBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conversationId: UUID
    turnId: UUID


class ExtractBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    attachmentId: UUID
    fileSize: Annotated[int, Field(strict=True, ge=0)]


class NdjsonResponse(StreamingResponse):
    media_type = "application/x-ndjson"


class SessionResponse(BaseModel):
    userId: str
    workspaceId: str


class JobResponse(BaseModel):
    id: str


class ServiceTokenFirstRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handle = super().get_route_handler()

        async def handle_after_token_check(request: Request) -> Response:
            require_service_token(
                request.app.state.settings, request.headers.get("x-service-token")
            )
            return await handle(request)

        return handle_after_token_check


def ndjson_lines(events: Generator[Event]) -> Generator[str]:
    for event in events:
        yield json.dumps(event, ensure_ascii=False) + "\n"


async def stream_until_closed(events: Generator[Event]) -> AsyncIterator[str]:
    try:
        async for line in iterate_in_threadpool(ndjson_lines(events)):
            yield line
    finally:
        events.close()


def create_app(
    settings: Settings,
    redis: Redis,
    ask_pipeline: AskPipeline,
    extraction_pipeline: ExtractionPipeline,
) -> FastAPI:
    app = FastAPI(docs_url=None, redoc_url=None)
    app.state.settings = settings
    conversations = ConversationStore(redis)
    app.router.route_class = ServiceTokenFirstRoute

    @app.exception_handler(ApiError)
    def api_error(_: Request, error: ApiError) -> JSONResponse:
        return JSONResponse(
            status_code=error.status_code,
            content={"code": error.code, "message": error.message},
        )

    @app.exception_handler(RequestValidationError)
    def invalid_request(_: Request, __: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=ERROR_STATUS["invalid_request"],
            content={"code": "invalid_request", "message": "The request body is not valid."},
        )

    @app.post("/v1/session")
    def session(user: Annotated[UserSession, Depends(require_user_session)]) -> SessionResponse:
        return SessionResponse(userId=user.user_id, workspaceId=user.workspace_id)

    @app.post("/v1/ask", response_class=NdjsonResponse)
    def ask(
        body: AskBody, user: Annotated[UserSession, Depends(require_user_session)]
    ) -> NdjsonResponse:
        events = ask_pipeline.ask(body.to_request(), user.user_id, user.space_ids, user.token)
        return NdjsonResponse(stream_until_closed(events))

    @app.post("/v1/extract")
    async def extract(
        body: ExtractBody, _: Annotated[UserSession, Depends(require_user_session)]
    ) -> dict[str, Any]:
        try:
            result = await run_in_threadpool(
                extraction_pipeline.extract, str(body.attachmentId), body.fileSize
            )
        except BridgeError as error:
            LOGGER.warning(
                "extract attachment=%s bridge_error=%s", body.attachmentId, type(error).__name__
            )
            if isinstance(error, AttachmentNotFound):
                raise ApiError("attachment_not_found", "The attachment does not exist.") from error
            raise ApiError(
                "assistant_unavailable", "The wiki could not deliver the file."
            ) from error
        return result.to_wire()

    @app.post("/v1/conversations/confirm", status_code=204)
    def confirm(
        body: ConfirmBody, user: Annotated[UserSession, Depends(require_user_session)]
    ) -> None:
        conversations.confirm(user.user_id, str(body.conversationId), str(body.turnId))

    @app.post("/v1/jobs", status_code=202)
    def jobs(body: JobRequest) -> JobResponse:
        return JobResponse(id=enqueue_job(redis, body.name, body.data))

    return app
