import json
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import pytest

from ai_service.bridge_client import (
    ATTACHMENT_PATH,
    FILTER_PAGES_PATH,
    PAGE_CONTENT_PATH,
    PAGES_PATH,
    AttachmentNotFound,
    BridgeClient,
    BridgeError,
    BridgeRefused,
    BridgeUnavailable,
    BridgeUnreachable,
    NotFound,
    PageNotFound,
    SpaceNotFound,
)
from ai_service.proposals import Block
from tests.conftest import SERVICE_CREDENTIAL
from tests.fake_bridge import (
    TASK_TOKEN,
    TASK_TOKEN_EXPIRES_AT,
    USER_TOKEN,
    AgentBridge,
    FailureKind,
    FakePage,
)

CONTRACT_PATH = Path(__file__).resolve().parents[2] / "docs" / "contracts" / "ai-bridge.json"
ENDPOINTS: dict[str, dict[str, Any]] = {
    endpoint["path"]: endpoint
    for endpoint in json.loads(CONTRACT_PATH.read_text())["endpoints"]
    if endpoint["side"] == "bridge"
}
TOKEN = SERVICE_CREDENTIAL
PAGE_ID = "0192f000-0000-7000-8000-000000000001"
ATTACHMENT_ID = "0192f000-0000-7000-9000-000000000001"
UPDATED_AT = "2026-10-01T12:00:00.000Z"

PAGES_BODY = {
    "pages": [{"id": PAGE_ID, "spaceId": "space-1", "updatedAt": UPDATED_AT}],
    "nextCursor": "cursor-2",
}
CONTENT_BODY = {
    "id": PAGE_ID,
    "title": "Titel",
    "spaceId": "space-1",
    "workspaceId": "workspace-1",
    "updatedAt": UPDATED_AT,
    "markdown": "# Titel",
    "attachments": [
        {"id": ATTACHMENT_ID, "fileName": "a.pdf", "mimeType": "application/pdf", "fileSize": 12}
    ],
}


def client_for(handler: Callable[[httpx.Request], httpx.Response]) -> BridgeClient:
    http = httpx.Client(base_url="http://wiki.test", transport=httpx.MockTransport(handler))
    return BridgeClient("http://wiki.test", TOKEN, http)


def answering(status: int, code: str | None = None) -> BridgeClient:
    body = {"code": code, "message": "secret page text"} if code else {}
    return client_for(lambda request: httpx.Response(status, json=body))


def raising(error: Exception) -> BridgeClient:
    def handler(request: httpx.Request) -> httpx.Response:
        raise error

    return client_for(handler)


def test_index_bridge_client_parses_the_page_list() -> None:
    client = client_for(lambda request: httpx.Response(200, json=PAGES_BODY))
    part = client.list_pages(None)
    assert part.next_cursor == "cursor-2"
    assert [(page.id, page.space_id) for page in part.pages] == [(PAGE_ID, "space-1")]
    assert part.pages[0].updated_at == datetime(2026, 10, 1, 12, 0, tzinfo=UTC)


def test_index_bridge_client_last_page_list_part_has_no_cursor() -> None:
    client = client_for(lambda request: httpx.Response(200, json={"pages": [], "nextCursor": None}))
    part = client.list_pages("cursor-2")
    assert part.pages == []
    assert part.next_cursor is None


def test_index_bridge_client_parses_the_page_content() -> None:
    client = client_for(lambda request: httpx.Response(200, json=CONTENT_BODY))
    content = client.page_content(PAGE_ID)
    assert (content.id, content.title, content.space_id, content.workspace_id) == (
        PAGE_ID,
        "Titel",
        "space-1",
        "workspace-1",
    )
    assert content.markdown == "# Titel"
    assert content.updated_at == datetime(2026, 10, 1, 12, 0, tzinfo=UTC)
    [attachment] = content.attachments
    assert (attachment.id, attachment.file_name, attachment.mime_type, attachment.file_size) == (
        ATTACHMENT_ID,
        "a.pdf",
        "application/pdf",
        12,
    )


def test_index_bridge_client_returns_attachment_bytes() -> None:
    client = client_for(lambda request: httpx.Response(200, content=b"%PDF-bytes"))
    assert client.attachment(ATTACHMENT_ID) == b"%PDF-bytes"


def test_index_bridge_client_sends_the_service_token_header_to_every_endpoint() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path == PAGES_PATH:
            return httpx.Response(200, json=PAGES_BODY)
        if request.url.path == PAGE_CONTENT_PATH:
            return httpx.Response(200, json=CONTENT_BODY)
        return httpx.Response(200, content=b"x")

    client = client_for(handler)
    client.list_pages(None)
    client.page_content(PAGE_ID)
    client.attachment(ATTACHMENT_ID)
    assert [request.method for request in seen] == ["POST"] * 3
    assert [request.headers["X-Service-Token"] for request in seen] == [TOKEN] * 3


@pytest.mark.parametrize(
    "client",
    [
        raising(httpx.ConnectError("refused")),
        raising(httpx.ReadTimeout("slow")),
        raising(httpx.ConnectTimeout("slow")),
        answering(500),
        answering(502),
        answering(503, "assistant_disabled"),
        answering(401, "service_token_invalid"),
        answering(401, "service_token_missing"),
    ],
)
def test_index_bridge_client_unreachable_or_refusing_bridge_is_unavailable(
    client: BridgeClient,
) -> None:
    with pytest.raises(BridgeUnavailable):
        client.page_content(PAGE_ID)


@pytest.mark.parametrize(
    "client",
    [
        raising(httpx.ConnectError("refused")),
        raising(httpx.ReadTimeout("slow")),
        raising(httpx.ConnectTimeout("slow")),
    ],
)
def test_index_ac79_transport_errors_and_timeouts_are_unreachable(client: BridgeClient) -> None:
    with pytest.raises(BridgeUnreachable):
        client.list_pages(None)


@pytest.mark.parametrize(
    "client",
    [
        answering(503, "assistant_disabled"),
        answering(401, "service_token_invalid"),
        answering(401, "service_token_missing"),
    ],
)
def test_index_bridge_client_disabled_assistant_or_rejected_token_is_refused(
    client: BridgeClient,
) -> None:
    with pytest.raises(BridgeRefused) as raised:
        client.list_pages(None)
    assert not isinstance(raised.value, BridgeUnreachable)


@pytest.mark.parametrize("client", [answering(500), answering(502), answering(503)])
def test_index_bridge_client_server_error_is_unavailable_but_neither_unreachable_nor_refused(
    client: BridgeClient,
) -> None:
    with pytest.raises(BridgeUnavailable) as raised:
        client.list_pages(None)
    assert not isinstance(raised.value, BridgeUnreachable | BridgeRefused)


def test_index_bridge_client_page_not_found_has_its_own_error() -> None:
    with pytest.raises(PageNotFound):
        answering(404, "page_not_found").page_content(PAGE_ID)


def test_index_bridge_client_attachment_not_found_has_its_own_error() -> None:
    with pytest.raises(AttachmentNotFound):
        answering(404, "attachment_not_found").attachment(ATTACHMENT_ID)


@pytest.mark.parametrize(
    "client",
    [answering(400, "invalid_request"), answering(404), answering(404, "space_not_found")],
)
def test_index_bridge_client_other_errors_are_bridge_errors_but_not_unavailable(
    client: BridgeClient,
) -> None:
    with pytest.raises(BridgeError) as raised:
        client.page_content(PAGE_ID)
    assert not isinstance(raised.value, BridgeUnavailable | PageNotFound | AttachmentNotFound)


def test_index_bridge_client_cause_has_status_and_code_but_no_token_or_body() -> None:
    with pytest.raises(BridgeUnavailable) as raised:
        answering(401, "service_token_invalid").page_content(PAGE_ID)
    assert raised.value.cause == "bridge answered 401 service_token_invalid"
    assert TOKEN not in raised.value.cause
    assert "secret page text" not in raised.value.cause


def test_index_bridge_client_transport_cause_names_no_token() -> None:
    with pytest.raises(BridgeUnavailable) as raised:
        raising(httpx.ConnectError(f"refused {TOKEN}")).page_content(PAGE_ID)
    assert TOKEN not in raised.value.cause


def request_fields(path: str, call: Callable[[BridgeClient], object]) -> set[str]:
    bodies: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        if path == PAGES_PATH:
            return httpx.Response(200, json=PAGES_BODY)
        if path == PAGE_CONTENT_PATH:
            return httpx.Response(200, json=CONTENT_BODY)
        if path == FILTER_PAGES_PATH:
            return httpx.Response(200, json={"pageIds": [PAGE_ID]})
        return httpx.Response(200, content=b"x")

    call(client_for(handler))
    assert len(bodies) == 1
    return set(bodies[0])


def test_index_bridge_client_request_fields_equal_the_contract() -> None:
    sent = {
        PAGES_PATH: request_fields(PAGES_PATH, lambda client: client.list_pages("cursor-1")),
        PAGE_CONTENT_PATH: request_fields(
            PAGE_CONTENT_PATH, lambda client: client.page_content(PAGE_ID)
        ),
        ATTACHMENT_PATH: request_fields(
            ATTACHMENT_PATH, lambda client: client.attachment(ATTACHMENT_ID)
        ),
        FILTER_PAGES_PATH: request_fields(
            FILTER_PAGES_PATH,
            lambda client: client.filter_pages([PAGE_ID], "test-user-token", PAGE_ID),
        ),
    }
    for path, fields in sent.items():
        assert fields == set(ENDPOINTS[path]["request"]), path


class RecordingDict(dict[str, Any]):
    def __init__(self, data: dict[str, Any], read: set[str], prefix: str) -> None:
        super().__init__(data)
        self._read = read
        self._prefix = prefix

    def __getitem__(self, key: str) -> Any:
        path = self._prefix + key
        self._read.add(path)
        return recording(super().__getitem__(key), self._read, path)


def recording(value: Any, read: set[str], path: str) -> Any:
    if isinstance(value, dict):
        return RecordingDict(value, read, path + ".")
    if isinstance(value, list):
        return [recording(item, read, path + "[]") for item in value]
    return value


def read_leaf_fields(body: dict[str, Any], call: Callable[[BridgeClient], object]) -> set[str]:
    read: set[str] = set()

    class RecordingResponse(httpx.Response):
        def json(self, **kwargs: Any) -> Any:
            return RecordingDict(super().json(**kwargs), read, "")

    call(client_for(lambda request: RecordingResponse(200, json=body)))
    return {field for field in read if not any(other.startswith(field + "[]") for other in read)}


def test_index_bridge_client_parsed_response_fields_equal_the_contract() -> None:
    pages = read_leaf_fields(PAGES_BODY, lambda client: client.list_pages(None))
    content = read_leaf_fields(CONTENT_BODY, lambda client: client.page_content(PAGE_ID))
    assert pages == set(ENDPOINTS[PAGES_PATH]["response"])
    assert content == set(ENDPOINTS[PAGE_CONTENT_PATH]["response"])
    assert ENDPOINTS[ATTACHMENT_PATH]["response"] == []


SPACE_ID = "0192f000-0000-7000-a000-000000000001"
OTHER_SPACE_ID = "0192f000-0000-7000-a000-000000000002"
RUN_ID = "0192f000-0000-7000-b000-000000000001"
BLOCKS = (
    Block(number=1, text="Reisekosten", heading=None, editable=True),
    Block(number=2, text="Hotel bis 120 Euro", heading="Reisekosten", editable=False),
)


def agent_bridge(viewable: bool = True, trashed: bool = False) -> AgentBridge:
    return AgentBridge(
        pages=[
            FakePage(
                id=PAGE_ID,
                space_id=SPACE_ID,
                title="Reisekosten",
                blocks=BLOCKS,
                viewable=viewable,
                trashed=trashed,
            )
        ]
    )


def test_agent_task_token_exchange_sends_user_token_and_run_id() -> None:
    bridge = agent_bridge()
    token = bridge.client().task_token(USER_TOKEN, RUN_ID)
    assert token.token == TASK_TOKEN
    assert token.expires_at == TASK_TOKEN_EXPIRES_AT
    assert json.loads(bridge.requests[0].content) == {"runId": RUN_ID}
    assert bridge.tokens == [("/api/ai-bridge/internal/task-token", USER_TOKEN)]


def test_agent_task_token_rejected_user_token_is_a_bridge_error() -> None:
    with pytest.raises(BridgeError):
        agent_bridge().client().task_token("expired", RUN_ID)


def test_agent_task_token_malformed_response_is_a_bridge_error() -> None:
    client = client_for(lambda request: httpx.Response(200, json={"expiresAt": UPDATED_AT}))
    with pytest.raises(BridgeError):
        client.task_token(USER_TOKEN, RUN_ID)


def test_agent_ac26_read_blocks_sends_the_task_token_and_parses_blocks() -> None:
    bridge = agent_bridge()
    read = bridge.client().read_blocks(TASK_TOKEN, PAGE_ID, SPACE_ID)
    assert (read.id, read.title, read.space_id, read.fingerprint) == (
        PAGE_ID,
        "Reisekosten",
        SPACE_ID,
        "fingerprint-1",
    )
    assert read.blocks == BLOCKS
    assert json.loads(bridge.requests[0].content) == {"pageId": PAGE_ID, "spaceId": SPACE_ID}
    assert bridge.tokens == [("/api/ai-bridge/internal/tools/read-blocks", TASK_TOKEN)]


def test_agent_ac34_read_blocks_parses_is_heading() -> None:
    heading = Block(number=1, text="Reisekosten", heading=None, editable=True, is_heading=True)
    bridge = AgentBridge(
        pages=[
            FakePage(
                id=PAGE_ID,
                space_id=SPACE_ID,
                title="Reisekosten",
                blocks=(heading, BLOCKS[1]),
            )
        ]
    )
    read = bridge.client().read_blocks(TASK_TOKEN, PAGE_ID, SPACE_ID)
    assert [block.is_heading for block in read.blocks] == [True, False]


@pytest.mark.parametrize(
    "is_heading",
    [{}, {"isHeading": "true"}, {"isHeading": 1}],
    ids=["missing", "string", "number"],
)
def test_agent_ac34_read_blocks_is_heading_must_be_a_bool(is_heading: dict[str, Any]) -> None:
    block = {"number": 1, "text": "x", "heading": None, "editable": True, **is_heading}
    body = {"id": PAGE_ID, "title": "t", "spaceId": SPACE_ID, "fingerprint": "f", "blocks": [block]}
    client = client_for(lambda request: httpx.Response(200, json=body))
    with pytest.raises(BridgeError):
        client.read_blocks(TASK_TOKEN, PAGE_ID, SPACE_ID)


def test_agent_ac26_tools_reject_the_user_token() -> None:
    client = agent_bridge().client()
    with pytest.raises(BridgeError):
        client.read_blocks(USER_TOKEN, PAGE_ID, SPACE_ID)
    with pytest.raises(BridgeError):
        client.search_pages(USER_TOKEN, SPACE_ID, "Hotel")


@pytest.mark.parametrize(
    "flags",
    [{"viewable": False}, {"trashed": True}],
    ids=["not-viewable", "trashed"],
)
def test_agent_ac27_ac28_unreadable_page_is_not_found(flags: dict[str, bool]) -> None:
    with pytest.raises(PageNotFound):
        agent_bridge(**flags).client().read_blocks(TASK_TOKEN, PAGE_ID, SPACE_ID)


def test_agent_ac29_page_in_another_space_or_unknown_is_not_found() -> None:
    client = agent_bridge().client()
    with pytest.raises(PageNotFound):
        client.read_blocks(TASK_TOKEN, PAGE_ID, OTHER_SPACE_ID)
    with pytest.raises(PageNotFound):
        client.read_blocks(TASK_TOKEN, "0192f000-0000-7000-8000-0000000000ff", SPACE_ID)


def test_agent_ac31_not_found_variants_share_one_handling() -> None:
    assert issubclass(PageNotFound, NotFound)
    assert issubclass(SpaceNotFound, NotFound)
    with pytest.raises(NotFound):
        answering(404, "page_not_found").read_blocks(TASK_TOKEN, PAGE_ID, SPACE_ID)
    with pytest.raises(SpaceNotFound):
        answering(404, "space_not_found").search_pages(TASK_TOKEN, SPACE_ID, "Hotel")
    with pytest.raises(NotFound):
        agent_bridge().client().search_pages(TASK_TOKEN, OTHER_SPACE_ID, "Hotel")


def test_agent_ac26_search_returns_viewable_pages_of_the_space() -> None:
    bridge = agent_bridge()
    bridge.pages.append(
        FakePage(id="hidden", space_id=SPACE_ID, title="Reisekosten geheim", viewable=False)
    )
    results = bridge.client().search_pages(TASK_TOKEN, SPACE_ID, "hotel")
    assert [(item.id, item.title, item.space_id) for item in results] == [
        (PAGE_ID, "Reisekosten", SPACE_ID)
    ]
    assert json.loads(bridge.requests[0].content) == {"spaceId": SPACE_ID, "query": "hotel"}
    assert bridge.tokens == [("/api/ai-bridge/internal/tools/search", TASK_TOKEN)]


@pytest.mark.parametrize("kind", ["server_error", "timeout", "unreachable"])
def test_agent_ac23_failures_are_unavailable_and_not_not_found(kind: FailureKind) -> None:
    for call in (
        lambda client: client.read_blocks(TASK_TOKEN, PAGE_ID, SPACE_ID),
        lambda client: client.search_pages(TASK_TOKEN, SPACE_ID, "Hotel"),
        lambda client: client.task_token(USER_TOKEN, RUN_ID),
    ):
        bridge = agent_bridge()
        bridge.fail_next(kind)
        with pytest.raises(BridgeUnavailable) as raised:
            call(bridge.client())
        assert not isinstance(raised.value, NotFound)


@pytest.mark.parametrize(
    "body",
    [
        {"id": PAGE_ID, "title": "t", "spaceId": SPACE_ID, "fingerprint": "f"},
        {"id": PAGE_ID, "title": "t", "spaceId": SPACE_ID, "fingerprint": "f", "blocks": [1]},
        {
            "id": PAGE_ID,
            "title": "t",
            "spaceId": SPACE_ID,
            "fingerprint": "f",
            "blocks": [{"number": "1", "text": "x", "heading": None, "editable": True}],
        },
        {"title": "t", "spaceId": SPACE_ID, "fingerprint": "f", "blocks": []},
    ],
    ids=["no-blocks", "block-not-object", "number-not-int", "no-id"],
)
def test_agent_read_blocks_malformed_response_is_a_bridge_error(body: dict[str, Any]) -> None:
    client = client_for(lambda request: httpx.Response(200, json=body))
    with pytest.raises(BridgeError):
        client.read_blocks(TASK_TOKEN, PAGE_ID, SPACE_ID)


def test_agent_search_malformed_response_is_a_bridge_error() -> None:
    client = client_for(lambda request: httpx.Response(200, json={"results": [{"id": 1}]}))
    with pytest.raises(BridgeError):
        client.search_pages(TASK_TOKEN, SPACE_ID, "Hotel")
