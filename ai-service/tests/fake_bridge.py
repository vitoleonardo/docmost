import json
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal

import httpx

from ai_service.bridge_client import (
    ATTACHMENT_PATH,
    FILTER_PAGES_PATH,
    PAGE_CONTENT_PATH,
    PAGES_PATH,
    READ_BLOCKS_TOOL_PATH,
    SEARCH_TOOL_PATH,
    TASK_TOKEN_PATH,
    USER_TOKEN_HEADER,
    BridgeClient,
)
from ai_service.proposals import Block
from tests.conftest import SERVICE_CREDENTIAL
from tests.index_db import (
    SPACE_A,
    SPACE_B,
    SPACE_C,
    UPDATED_AT,
    WORKSPACE_A,
    attachment_id,
    later,
    page_id,
)
from tests.pdf_fixtures import build_pdf

TOKEN = SERVICE_CREDENTIAL
WIKI_URL = "http://wiki.test"
PDF_FILE_NAME = "reisekosten.pdf"
CURSOR_SIGNATURE = ".fake-signature"


def mock_client(handler: Callable[[httpx.Request], httpx.Response]) -> BridgeClient:
    http = httpx.Client(base_url=WIKI_URL, transport=httpx.MockTransport(handler))
    return BridgeClient(WIKI_URL, TOKEN, http)


@dataclass
class WikiPage:
    space_id: str
    title: str
    markdown: str
    updated_at: datetime = UPDATED_AT
    attachments: list[dict[str, object]] = field(default_factory=list)
    listed: bool = True


@dataclass
class FakeBridge:
    pages: dict[str, WikiPage] = field(default_factory=dict)
    files: dict[str, bytes] = field(default_factory=dict)
    page_size: int = 2
    failing_list_part: int | None = None
    list_failure: Callable[[], httpx.Response] | None = None
    content_failures: dict[str, Callable[[], httpx.Response]] = field(default_factory=dict)
    after_list_read: Callable[[], None] | None = None
    repeated_page: str | None = None
    list_requests: list[str | None] = field(default_factory=list)
    content_requests: list[str] = field(default_factory=list)
    attachment_requests: list[str] = field(default_factory=list)

    def client(self) -> BridgeClient:
        return mock_client(self.handle)

    def listed_ids(self) -> list[str]:
        return sorted(identifier for identifier, page in self.pages.items() if page.listed)

    def reset_requests(self) -> None:
        self.list_requests.clear()
        self.content_requests.clear()
        self.attachment_requests.clear()

    def handle(self, request: httpx.Request) -> httpx.Response:
        assert request.headers["X-Service-Token"] == TOKEN
        body = json.loads(request.content)
        if request.url.path == PAGES_PATH:
            return self._page_list(body.get("cursor"))
        if request.url.path == PAGE_CONTENT_PATH:
            return self._page_content(body["pageId"])
        assert request.url.path == ATTACHMENT_PATH
        self.attachment_requests.append(body["attachmentId"])
        return httpx.Response(200, content=self.files[body["attachmentId"]])

    def _page_list(self, cursor: str | None) -> httpx.Response:
        self.list_requests.append(cursor)
        part_number = len(self.list_requests)
        if part_number == self.failing_list_part and self.list_failure is not None:
            return self.list_failure()
        after = None if cursor is None else cursor.removesuffix(CURSOR_SIGNATURE)
        remaining = [
            identifier for identifier in self.listed_ids() if after is None or identifier > after
        ]
        part = remaining[: self.page_size]
        next_cursor = part[-1] + CURSOR_SIGNATURE if len(remaining) > self.page_size else None
        if next_cursor is None and self.repeated_page is not None:
            part = [*part, self.repeated_page]
        response = httpx.Response(
            200,
            json={
                "pages": [
                    {
                        "id": identifier,
                        "spaceId": self.pages[identifier].space_id,
                        "updatedAt": self.pages[identifier].updated_at.isoformat(),
                    }
                    for identifier in part
                ],
                "nextCursor": next_cursor,
            },
        )
        if next_cursor is None and self.after_list_read is not None:
            self.after_list_read()
        return response

    def _page_content(self, requested: str) -> httpx.Response:
        self.content_requests.append(requested)
        failure = self.content_failures.get(requested)
        if failure is not None:
            return failure()
        page = self.pages.get(requested)
        if page is None or not page.listed:
            return httpx.Response(404, json={"code": "page_not_found", "message": "gone"})
        return httpx.Response(
            200,
            json={
                "id": requested,
                "title": page.title,
                "spaceId": page.space_id,
                "workspaceId": WORKSPACE_A,
                "updatedAt": page.updated_at.isoformat(),
                "markdown": page.markdown,
                "attachments": page.attachments,
            },
        )


@dataclass
class FilterBridge:
    viewable: set[str] = field(default_factory=set)
    current_spaces: dict[str, str] = field(default_factory=dict)
    failure: Callable[[], httpx.Response] | None = None
    requests: list[list[str]] = field(default_factory=list)
    space_ids: list[str | None] = field(default_factory=list)
    user_tokens: list[str] = field(default_factory=list)

    def client(self) -> BridgeClient:
        return mock_client(self.handle)

    def handle(self, request: httpx.Request) -> httpx.Response:
        assert request.headers["X-Service-Token"] == TOKEN
        assert request.url.path == FILTER_PAGES_PATH
        self.user_tokens.append(request.headers[USER_TOKEN_HEADER])
        body = json.loads(request.content)
        requested = body["pageIds"]
        space_id = body.get("spaceId")
        self.requests.append(requested)
        self.space_ids.append(space_id)
        if self.failure is not None:
            return self.failure()
        return httpx.Response(
            200,
            json={
                "pageIds": [
                    identifier
                    for identifier in requested
                    if identifier in self.viewable
                    and (space_id is None or self.current_spaces.get(identifier) == space_id)
                ]
            },
        )


USER_TOKEN = "user-token"
TASK_TOKEN = "task-token"
TASK_TOKEN_EXPIRES_AT = "2026-10-30T12:00:00.000Z"
MAX_SEARCH_RESULTS = 20
FailureKind = Literal["server_error", "timeout", "unreachable"]


@dataclass
class FakePage:
    id: str
    space_id: str
    title: str
    blocks: tuple[Block, ...] = ()
    fingerprint: str = "fingerprint-1"
    viewable: bool = True
    trashed: bool = False


@dataclass
class AgentBridge:
    pages: list[FakePage] = field(default_factory=list)
    spaces: set[str] | None = None
    requests: list[httpx.Request] = field(default_factory=list)
    tokens: list[tuple[str, str]] = field(default_factory=list)
    failures: list[FailureKind] = field(default_factory=list)

    def client(self) -> BridgeClient:
        return mock_client(self.handle)

    def fail_next(self, kind: FailureKind) -> None:
        self.failures.append(kind)

    def paths(self) -> list[str]:
        return [request.url.path for request in self.requests]

    def handle(self, request: httpx.Request) -> httpx.Response:
        assert request.headers["X-Service-Token"] == TOKEN
        self.requests.append(request)
        token = request.headers[USER_TOKEN_HEADER]
        self.tokens.append((request.url.path, token))
        if self.failures:
            return self._fail(self.failures.pop(0))
        body = json.loads(request.content)
        if request.url.path == TASK_TOKEN_PATH:
            return self._task_token(token, body)
        if token != TASK_TOKEN:
            return answer(401, "user_token_invalid")()
        if request.url.path == SEARCH_TOOL_PATH:
            return self._search(body["spaceId"], body["query"])
        assert request.url.path == READ_BLOCKS_TOOL_PATH
        return self._read_blocks(body["pageId"], body["spaceId"])

    def _fail(self, kind: FailureKind) -> httpx.Response:
        if kind == "timeout":
            raise httpx.ReadTimeout("slow")
        if kind == "unreachable":
            raise httpx.ConnectError("connection refused")
        return server_error()

    def _task_token(self, token: str, body: dict[str, str]) -> httpx.Response:
        if token != USER_TOKEN:
            return answer(401, "user_token_invalid")()
        assert body["runId"]
        return httpx.Response(
            200, json={"taskToken": TASK_TOKEN, "expiresAt": TASK_TOKEN_EXPIRES_AT}
        )

    def _space_known(self, space_id: str) -> bool:
        known = {page.space_id for page in self.pages} if self.spaces is None else self.spaces
        return space_id in known

    def _search(self, space_id: str, query: str) -> httpx.Response:
        if not self._space_known(space_id):
            return answer(404, "space_not_found")()
        needle = query.lower()
        found = [
            page
            for page in self.pages
            if page.space_id == space_id
            and page.viewable
            and not page.trashed
            and (
                needle in page.title.lower()
                or any(needle in block.text.lower() for block in page.blocks)
            )
        ]
        return httpx.Response(
            200,
            json={
                "results": [
                    {"id": page.id, "title": page.title, "spaceId": page.space_id}
                    for page in found[:MAX_SEARCH_RESULTS]
                ]
            },
        )

    def _read_blocks(self, page_id: str, space_id: str) -> httpx.Response:
        for page in self.pages:
            if (
                page.id == page_id
                and page.viewable
                and not page.trashed
                and page.space_id == space_id
            ):
                return httpx.Response(
                    200,
                    json={
                        "id": page.id,
                        "title": page.title,
                        "spaceId": page.space_id,
                        "fingerprint": page.fingerprint,
                        "blocks": [
                            {
                                "number": block.number,
                                "text": block.text,
                                "heading": block.heading,
                                "isHeading": block.is_heading,
                                "editable": block.editable,
                            }
                            for block in page.blocks
                        ],
                    },
                )
        return answer(404, "page_not_found")()


TEXT_PAGES = (1, 2, 4, 5)
EMPTY_PAGE = 3
TRASHED_PAGE = 6
PDF_PAGE = 2
PDF_ID = attachment_id(1)


def seed_shaped_bridge() -> FakeBridge:
    pdf = build_pdf(["Reisekosten werden binnen 30 Tagen erstattet", "Belege bitte einscannen"])
    bridge = FakeBridge(files={PDF_ID: pdf})
    bridge.pages = {
        page_id(1): WikiPage(
            SPACE_A,
            "Urlaubsregeln",
            "# Antrag\n\nUrlaub beantragt man zwei Wochen vorher."
            "\n\n## Fristen\n\nIm Dezember gilt eine Sperre.",
        ),
        page_id(2): WikiPage(
            SPACE_A,
            "Reisekosten",
            "Die Abrechnung erfolgt monatlich.",
            updated_at=later(5),
            attachments=[
                {
                    "id": PDF_ID,
                    "fileName": PDF_FILE_NAME,
                    "mimeType": "application/pdf",
                    "fileSize": len(pdf),
                }
            ],
        ),
        page_id(EMPTY_PAGE): WikiPage(SPACE_B, "Leere Seite", "", updated_at=later(10)),
        page_id(4): WikiPage(SPACE_B, "Onboarding", "# Erster Tag\n\nDer Laptop liegt bereit."),
        page_id(5): WikiPage(SPACE_C, "Kantine", "Die Kantine öffnet um acht Uhr.", later(15)),
        page_id(TRASHED_PAGE): WikiPage(
            SPACE_C, "Alte Regeln", "Diese Seite liegt im Papierkorb.", listed=False
        ),
    }
    return bridge


def server_error() -> httpx.Response:
    return httpx.Response(500, json={"code": "internal_error", "message": "failure"})


def refuse() -> httpx.Response:
    raise httpx.ConnectError("connection refused")


def answer(status: int, code: str) -> Callable[[], httpx.Response]:
    return lambda: httpx.Response(status, json={"code": code, "message": "failure"})


def bad_request() -> httpx.Response:
    return httpx.Response(400, json={"code": "invalid_request", "message": "failure"})
