import hmac
from dataclasses import dataclass
from typing import Annotated, Any

import jwt
from fastapi import Depends, Header, Request

from ai_service.settings import Settings

USER_TOKEN_ALGORITHM = "HS256"
USER_TOKEN_AUDIENCE = "ai-service"
USER_TOKEN_TYPE = "user"
USER_TOKEN_REGISTERED_CLAIMS = ("sub", "aud", "iat", "exp")
USER_TOKEN_CUSTOM_CLAIMS = ("workspaceId", "spaceIds", "type")

ERROR_STATUS = {
    "service_token_missing": 401,
    "service_token_invalid": 401,
    "user_token_missing": 401,
    "user_token_expired": 401,
    "user_token_invalid": 401,
    "invalid_request": 400,
    "attachment_not_found": 404,
    "proposal_not_found": 404,
    "proposal_not_open": 409,
    "run_in_progress": 409,
    "assistant_unavailable": 503,
}


class ApiError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = ERROR_STATUS[code]


@dataclass(frozen=True)
class UserSession:
    user_id: str
    workspace_id: str
    space_ids: tuple[str, ...]
    token: str


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def require_service_token(
    settings: Annotated[Settings, Depends(get_settings)],
    x_service_token: Annotated[str | None, Header()] = None,
) -> None:
    if not x_service_token:
        raise ApiError("service_token_missing", "The service token header is missing.")
    expected = settings.ai_service_token.encode()
    if not hmac.compare_digest(x_service_token.encode(), expected):
        raise ApiError("service_token_invalid", "The service token is not valid.")


def require_user_session(
    settings: Annotated[Settings, Depends(get_settings)],
    _: Annotated[None, Depends(require_service_token)],
    x_user_token: Annotated[str | None, Header()] = None,
) -> UserSession:
    if not x_user_token:
        raise ApiError("user_token_missing", "The user token header is missing.")
    claims = decode_user_token(x_user_token, settings.ai_bridge_secret)
    return UserSession(
        user_id=claims["sub"],
        workspace_id=claims["workspaceId"],
        space_ids=tuple(claims["spaceIds"]),
        token=x_user_token,
    )


def decode_user_token(token: str, secret: str) -> dict[str, Any]:
    try:
        claims: dict[str, Any] = jwt.decode(
            token,
            secret,
            algorithms=[USER_TOKEN_ALGORITHM],
            audience=USER_TOKEN_AUDIENCE,
            options={"require": list(USER_TOKEN_REGISTERED_CLAIMS)},
        )
    except jwt.ExpiredSignatureError as error:
        raise ApiError("user_token_expired", "The user token has expired.") from error
    except jwt.InvalidTokenError as error:
        raise ApiError("user_token_invalid", "The user token is not valid.") from error
    if (
        claims.get("type") != USER_TOKEN_TYPE
        or not _is_text(claims.get("workspaceId"))
        or not _is_text(claims["sub"])
        or not _is_text_list(claims.get("spaceIds"))
    ):
        raise ApiError("user_token_invalid", "The user token is not valid.")
    return claims


def _is_text(value: object) -> bool:
    return isinstance(value, str) and value != ""


def _is_text_list(value: object) -> bool:
    return isinstance(value, list) and all(isinstance(item, str) for item in value)
