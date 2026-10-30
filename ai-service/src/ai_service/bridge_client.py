from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import httpx

from ai_service.proposals import Block

TIMEOUT_SECONDS = 30
SERVICE_TOKEN_HEADER = "X-Service-Token"
PAGES_PATH = "/api/ai-bridge/internal/pages"
PAGE_CONTENT_PATH = "/api/ai-bridge/internal/page-content"
ATTACHMENT_PATH = "/api/ai-bridge/internal/attachment"
FILTER_PAGES_PATH = "/api/ai-bridge/internal/filter-pages"
USER_TOKEN_HEADER = "X-User-Token"
TASK_TOKEN_PATH = "/api/ai-bridge/internal/task-token"
SEARCH_TOOL_PATH = "/api/ai-bridge/internal/tools/search"
READ_BLOCKS_TOOL_PATH = "/api/ai-bridge/internal/tools/read-blocks"
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


class NotFound(BridgeError):
    pass


class PageNotFound(NotFound):
    pass


class SpaceNotFound(NotFound):
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


@dataclass(frozen=True)
class TaskToken:
    token: str
    expires_at: str


@dataclass(frozen=True)
class SearchResult:
    id: str
    title: str
    space_id: str


@dataclass(frozen=True)
class BlockRead:
    id: str
    title: str
    space_id: str
    fingerprint: str
    blocks: tuple[Block, ...]


def malformed(what: str) -> BridgeError:
    return BridgeError(f"bridge answered a malformed {what} response")


def json_object(response: httpx.Response, what: str) -> dict[str, Any]:
    try:
        data = response.json()
    except ValueError as error:
        raise malformed(what) from error
    if not isinstance(data, dict):
        raise malformed(what)
    return data


def text_field(data: dict[str, Any], key: str, what: str) -> str:
    value = data.get(key)
    if not isinstance(value, str):
        raise malformed(what)
    return value


def parse_block(item: Any) -> Block:
    if not isinstance(item, dict):
        raise malformed("read-blocks")
    number, heading, editable = item.get("number"), item.get("heading"), item.get("editable")
    is_heading = item.get("isHeading")
    if (
        not isinstance(number, int)
        or isinstance(number, bool)
        or not isinstance(item.get("text"), str)
        or not (heading is None or isinstance(heading, str))
        or not isinstance(editable, bool)
        or not isinstance(is_heading, bool)
    ):
        raise malformed("read-blocks")
    return Block(
        number=number,
        text=item["text"],
        heading=heading,
        editable=editable,
        is_heading=is_heading,
    )


def parse_search_result(item: Any) -> SearchResult:
    if not isinstance(item, dict):
        raise malformed("search")
    return SearchResult(
        id=text_field(item, "id", "search"),
        title=text_field(item, "title", "search"),
        space_id=text_field(item, "spaceId", "search"),
    )


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

    def task_token(self, user_token: str, run_id: str) -> TaskToken:
        response = self._post(TASK_TOKEN_PATH, {"runId": run_id}, {USER_TOKEN_HEADER: user_token})
        data = json_object(response, "task token")
        return TaskToken(
            token=text_field(data, "taskToken", "task token"),
            expires_at=text_field(data, "expiresAt", "task token"),
        )

    def search_pages(self, task_token: str, space_id: str, query: str) -> list[SearchResult]:
        response = self._post(
            SEARCH_TOOL_PATH,
            {"spaceId": space_id, "query": query},
            {USER_TOKEN_HEADER: task_token},
        )
        results = json_object(response, "search").get("results")
        if not isinstance(results, list):
            raise malformed("search")
        return [parse_search_result(item) for item in results]

    def read_blocks(self, task_token: str, page_id: str, space_id: str) -> BlockRead:
        response = self._post(
            READ_BLOCKS_TOOL_PATH,
            {"pageId": page_id, "spaceId": space_id},
            {USER_TOKEN_HEADER: task_token},
        )
        data = json_object(response, "read-blocks")
        blocks = data.get("blocks")
        if not isinstance(blocks, list):
            raise malformed("read-blocks")
        return BlockRead(
            id=text_field(data, "id", "read-blocks"),
            title=text_field(data, "title", "read-blocks"),
            space_id=text_field(data, "spaceId", "read-blocks"),
            fingerprint=text_field(data, "fingerprint", "read-blocks"),
            blocks=tuple(parse_block(item) for item in blocks),
        )

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
        if response.status_code == 404 and code == "space_not_found":
            raise SpaceNotFound(cause)
        if response.status_code == 404 and code == "attachment_not_found":
            raise AttachmentNotFound(cause)
        raise BridgeError(cause)
