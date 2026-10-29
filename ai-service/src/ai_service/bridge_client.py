from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import httpx

TIMEOUT_SECONDS = 30
SERVICE_TOKEN_HEADER = "X-Service-Token"
PAGES_PATH = "/api/ai-bridge/internal/pages"
PAGE_CONTENT_PATH = "/api/ai-bridge/internal/page-content"
ATTACHMENT_PATH = "/api/ai-bridge/internal/attachment"
FILTER_PAGES_PATH = "/api/ai-bridge/internal/filter-pages"
USER_TOKEN_HEADER = "X-User-Token"
MAX_FILTER_PAGE_IDS = 500
REFUSING_CODES = {"assistant_disabled", "service_token_missing", "service_token_invalid"}


class BridgeError(Exception):
    def __init__(self, cause: str) -> None:
        super().__init__(cause)
        self.cause = cause


class BridgeUnavailable(BridgeError):
    pass


class BridgeUnreachable(BridgeUnavailable):
    pass


class BridgeRefused(BridgeUnavailable):
    pass


class PageNotFound(BridgeError):
    pass


class AttachmentNotFound(BridgeError):
    pass


@dataclass(frozen=True)
class ListedPage:
    id: str
    space_id: str
    updated_at: datetime


@dataclass(frozen=True)
class PageListPart:
    pages: list[ListedPage]
    next_cursor: str | None


@dataclass(frozen=True)
class AttachmentInfo:
    id: str
    file_name: str
    mime_type: str
    file_size: int


@dataclass(frozen=True)
class PageContent:
    id: str
    title: str
    space_id: str
    workspace_id: str
    updated_at: datetime
    markdown: str
    attachments: list[AttachmentInfo]


def error_code(response: httpx.Response) -> str | None:
    try:
        body = response.json()
    except ValueError:
        return None
    code = body.get("code") if isinstance(body, dict) else None
    return code if isinstance(code, str) else None


def describe(response: httpx.Response, code: str | None) -> str:
    suffix = f" {code}" if code else ""
    return f"bridge answered {response.status_code}{suffix}"


class BridgeClient:
    def __init__(self, base_url: str, service_token: str, http: httpx.Client | None = None) -> None:
        self._http = http or httpx.Client(base_url=base_url, timeout=TIMEOUT_SECONDS)
        self._headers = {SERVICE_TOKEN_HEADER: service_token}

    def list_pages(self, cursor: str | None) -> PageListPart:
        body: dict[str, Any] = {} if cursor is None else {"cursor": cursor}
        data = self._post(PAGES_PATH, body).json()
        return PageListPart(
            pages=[
                ListedPage(
                    id=item["id"],
                    space_id=item["spaceId"],
                    updated_at=datetime.fromisoformat(item["updatedAt"]),
                )
                for item in data["pages"]
            ],
            next_cursor=data["nextCursor"],
        )

    def page_content(self, page_id: str) -> PageContent:
        data = self._post(PAGE_CONTENT_PATH, {"pageId": page_id}).json()
        return PageContent(
            id=data["id"],
            title=data["title"],
            space_id=data["spaceId"],
            workspace_id=data["workspaceId"],
            updated_at=datetime.fromisoformat(data["updatedAt"]),
            markdown=data["markdown"],
            attachments=[
                AttachmentInfo(
                    id=item["id"],
                    file_name=item["fileName"],
                    mime_type=item["mimeType"],
                    file_size=item["fileSize"],
                )
                for item in data["attachments"]
            ],
        )

    def attachment(self, attachment_id: str) -> bytes:
        return self._post(ATTACHMENT_PATH, {"attachmentId": attachment_id}).content

    def filter_pages(
        self, page_ids: Sequence[str], user_token: str, space_id: str | None = None
    ) -> list[str]:
        if len(page_ids) > MAX_FILTER_PAGE_IDS:
            raise ValueError(f"filter_pages takes at most {MAX_FILTER_PAGE_IDS} page ids")
        if not page_ids:
            return []
        body: dict[str, Any] = {"pageIds": list(page_ids)}
        if space_id is not None:
            body["spaceId"] = space_id
        response = self._post(FILTER_PAGES_PATH, body, {USER_TOKEN_HEADER: user_token})
        try:
            data = response.json()
        except ValueError as error:
            raise BridgeError("bridge answered a filter response that is not JSON") from error
        passing = data.get("pageIds") if isinstance(data, dict) else None
        if not isinstance(passing, list) or not all(isinstance(item, str) for item in passing):
            raise BridgeError("bridge answered a malformed filter response")
        return passing

    def _post(
        self, path: str, body: dict[str, Any], extra_headers: dict[str, str] | None = None
    ) -> httpx.Response:
        headers = {**self._headers, **(extra_headers or {})}
        try:
            response = self._http.post(path, json=body, headers=headers)
        except httpx.TimeoutException as error:
            raise BridgeUnreachable("bridge did not answer in time") from error
        except httpx.TransportError as error:
            raise BridgeUnreachable(f"bridge not reachable ({type(error).__name__})") from error
        if response.is_success:
            return response
        code = error_code(response)
        cause = describe(response, code)
        if code in REFUSING_CODES:
            raise BridgeRefused(cause)
        if response.status_code >= 500:
            raise BridgeUnavailable(cause)
        if response.status_code == 404 and code == "page_not_found":
            raise PageNotFound(cause)
        if response.status_code == 404 and code == "attachment_not_found":
            raise AttachmentNotFound(cause)
        raise BridgeError(cause)
