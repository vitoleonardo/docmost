import hmac
from dataclasses import dataclass
from typing import Annotated, Any

import jwt
from fastapi import Depends, Header, Request

from ai_service.settings import Settings


class ApiError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 401) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


@dataclass(frozen=True)
class UserSession:
    user_id: str
    workspace_id: str


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
    return UserSession(user_id=claims["sub"], workspace_id=claims["workspaceId"])


def decode_user_token(token: str, secret: str) -> dict[str, Any]:
    try:
        claims: dict[str, Any] = jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            audience="ai-service",
            options={"require": ["exp", "iat", "sub", "aud"]},
        )
    except jwt.ExpiredSignatureError as error:
        raise ApiError("user_token_expired", "The user token has expired.") from error
    except jwt.InvalidTokenError as error:
        raise ApiError("user_token_invalid", "The user token is not valid.") from error
    if claims.get("type") != "user" or not _is_text(claims.get("workspaceId")):
        raise ApiError("user_token_invalid", "The user token is not valid.")
    if not _is_text(claims["sub"]):
        raise ApiError("user_token_invalid", "The user token is not valid.")
    return claims


def _is_text(value: object) -> bool:
    return isinstance(value, str) and value != ""
