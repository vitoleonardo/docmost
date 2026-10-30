import asyncio
import json
import logging
import threading
import uuid
from collections.abc import AsyncIterator, Callable, Coroutine, Generator
from contextlib import AbstractContextManager, ExitStack
from dataclasses import dataclass
from typing import Annotated, Any, Protocol, Self
from uuid import UUID

from fastapi import Depends, FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from redis import Redis
from redis.exceptions import WatchError
from starlette.background import BackgroundTask
from starlette.concurrency import iterate_in_threadpool, run_in_threadpool

from ai_service.agent import AgentRunner, PreparedRun, RunStore
from ai_service.agent_store import (
    ProposalNotFound,
    ProposalNotOpen,
    ProposalStatus,
    StoredProposal,
)
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
MAX_TASK_LENGTH = 2000
AGENT_LOCK_PREFIX = "ai-service:agent-run:"
AGENT_LOCK_SECONDS = 660


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


class AgentRecords(RunStore, Protocol):
    def get_proposal(self, proposal_id: str, user_id: str) -> StoredProposal | None: ...

    def transition(self, proposal_id: str, user_id: str, to: ProposalStatus) -> StoredProposal: ...


@dataclass(frozen=True)
class AgentServices:
    open_records: Callable[[], AbstractContextManager[AgentRecords]]
    make_runner: Callable[[AgentRecords], AgentRunner]


class RunBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    spaceId: UUID
    task: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_TASK_LENGTH),
    ]


class ProposalBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    proposalId: UUID


class TransitionBody(ProposalBody):
    to: ProposalStatus


class ProposalResponse(BaseModel):
    id: str
    runId: str
    userId: str
    pageId: str
    pageTitle: str
    spaceId: str
    reason: str
    fingerprint: str
    changes: list[dict[str, Any]]
    added: int
    removed: int
    status: ProposalStatus
    appliedBy: str | None
    appliedAt: str | None

    @classmethod
    def from_stored(cls, proposal: StoredProposal) -> Self:
        return cls(
            id=proposal.id,
            runId=proposal.run_id,
            userId=proposal.user_id,
            pageId=proposal.page_id,
            pageTitle=proposal.page_title,
            spaceId=proposal.space_id,
            reason=proposal.reason,
            fingerprint=proposal.fingerprint,
            changes=proposal.changes,
            added=proposal.added,
            removed=proposal.removed,
            status=proposal.status,
            appliedBy=proposal.applied_by,
            appliedAt=proposal.applied_at.isoformat() if proposal.applied_at else None,
        )


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


class RunLock:
    def __init__(self, redis: Redis, user_id: str) -> None:
        self._redis = redis
        self._key = AGENT_LOCK_PREFIX + user_id
        self._holder = str(uuid.uuid4())

    def acquire(self) -> bool:
        return bool(self._redis.set(self._key, self._holder, nx=True, ex=AGENT_LOCK_SECONDS))

    def release(self) -> None:
        with self._redis.pipeline() as pipeline:
            try:
                pipeline.watch(self._key)
                if pipeline.get(self._key) == self._holder:
                    pipeline.multi()
                    pipeline.delete(self._key)
                    pipeline.execute()
            except WatchError:
                return


class AgentRunStream:
    def __init__(self, prepared: PreparedRun, lock: RunLock, resources: ExitStack) -> None:
        self._prepared = prepared
        self._lock = lock
        self._resources = resources
        self._cancel = threading.Event()
        self._reader_gone = threading.Event()
        self._loop = asyncio.get_running_loop()
        self._queue: asyncio.Queue[str | Exception | None] = asyncio.Queue()
        threading.Thread(target=self._pump, daemon=True).start()

    def stop(self) -> None:
        self._cancel.set()
        self._lock.release()

    async def lines(self) -> AsyncIterator[str]:
        try:
            while (item := await self._queue.get()) is not None:
                if isinstance(item, Exception):
                    raise item
                yield item
        finally:
            self._reader_gone.set()
            self.stop()

    def _post(self, item: str | Exception | None) -> None:
        if self._reader_gone.is_set():
            return
        self._loop.call_soon_threadsafe(self._queue.put_nowait, item)

    def _pump(self) -> None:
        events = self._prepared.events(self._cancel)
        try:
            try:
                for event in events:
                    if self._cancel.is_set():
                        break
                    self._post(json.dumps(event, ensure_ascii=False) + "\n")
            finally:
                events.close()
        except Exception as error:
            LOGGER.error(
                "agent run=%s stream_error=%s", self._prepared.run_id, type(error).__name__
            )
            self._post(error)
        finally:
            self.stop()
            self._resources.close()
            self._post(None)


def require_agent(agent: AgentServices | None) -> AgentServices:
    if agent is None:
        raise ApiError("assistant_unavailable", "The assistant is not available.")
    return agent


def prepare_agent_run(
    agent: AgentServices | None, redis: Redis, user: UserSession, body: RunBody
) -> tuple[RunLock, ExitStack, PreparedRun]:
    services = require_agent(agent)
    lock = RunLock(redis, user.user_id)
    if not lock.acquire():
        raise ApiError("run_in_progress", "A task is already running.")
    resources = ExitStack()
    try:
        runner = services.make_runner(resources.enter_context(services.open_records()))
        return lock, resources, runner.prepare(user, str(body.spaceId), body.task)
    except Exception as error:
        lock.release()
        resources.close()
        if isinstance(error, BridgeError):
            LOGGER.warning("agent bridge_error=%s", type(error).__name__)
            raise ApiError("assistant_unavailable", "The wiki is not available.") from error
        raise


def create_app(
    settings: Settings,
    redis: Redis,
    ask_pipeline: AskPipeline,
    extraction_pipeline: ExtractionPipeline,
    agent: AgentServices | None = None,
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
        events = ask_pipeline.ask(
            body.to_request(), user.user_id, user.workspace_id, user.space_ids, user.token
        )
        return NdjsonResponse(stream_until_closed(events))

    @app.post("/v1/extract")
    async def extract(
        body: ExtractBody, user: Annotated[UserSession, Depends(require_user_session)]
    ) -> dict[str, Any]:
        try:
            result = await run_in_threadpool(
                extraction_pipeline.extract,
                str(body.attachmentId),
                body.fileSize,
                user.user_id,
                user.workspace_id,
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

    @app.post("/v1/agent/runs", response_class=NdjsonResponse)
    async def agent_runs(
        body: RunBody, user: Annotated[UserSession, Depends(require_user_session)]
    ) -> NdjsonResponse:
        lock, resources, prepared = await run_in_threadpool(
            prepare_agent_run, agent, redis, user, body
        )
        stream = AgentRunStream(prepared, lock, resources)
        return NdjsonResponse(stream.lines(), background=BackgroundTask(stream.stop))

    @app.post("/v1/agent/proposals/get")
    def agent_proposal(
        body: ProposalBody, user: Annotated[UserSession, Depends(require_user_session)]
    ) -> ProposalResponse:
        with require_agent(agent).open_records() as records:
            proposal = records.get_proposal(str(body.proposalId), user.user_id)
        if proposal is None:
            raise ApiError("proposal_not_found", "The proposal does not exist.")
        return ProposalResponse.from_stored(proposal)

    @app.post("/v1/agent/proposals/transition")
    def agent_proposal_transition(
        body: TransitionBody, user: Annotated[UserSession, Depends(require_user_session)]
    ) -> ProposalResponse:
        try:
            with require_agent(agent).open_records() as records:
                proposal = records.transition(str(body.proposalId), user.user_id, body.to)
        except ProposalNotFound as error:
            raise ApiError("proposal_not_found", "The proposal does not exist.") from error
        except ProposalNotOpen as error:
            raise ApiError(
                "proposal_not_open", "The proposal cannot change to that state."
            ) from error
        return ProposalResponse.from_stored(proposal)

    @app.post("/v1/conversations/confirm", status_code=204)
    def confirm(
        body: ConfirmBody, user: Annotated[UserSession, Depends(require_user_session)]
    ) -> None:
        conversations.confirm(user.user_id, str(body.conversationId), str(body.turnId))

    @app.post("/v1/jobs", status_code=202)
    def jobs(body: JobRequest) -> JobResponse:
        return JobResponse(id=enqueue_job(redis, body.name, body.data))

    return app
