from typing import Annotated, Any

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from redis import Redis

from ai_service.auth import (
    ERROR_STATUS,
    ApiError,
    UserSession,
    require_service_token,
    require_user_session,
)
from ai_service.jobs import enqueue_job
from ai_service.settings import Settings


class JobRequest(BaseModel):
    name: str = Field(min_length=1)
    data: dict[str, Any]


class SessionResponse(BaseModel):
    userId: str
    workspaceId: str


class JobResponse(BaseModel):
    id: str


def create_app(settings: Settings, redis: Redis) -> FastAPI:
    app = FastAPI(docs_url=None, redoc_url=None)
    app.state.settings = settings

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

    @app.post("/v1/jobs", status_code=202, dependencies=[Depends(require_service_token)])
    def jobs(body: JobRequest) -> JobResponse:
        return JobResponse(id=enqueue_job(redis, body.name, body.data))

    return app
