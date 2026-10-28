import json
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import pytest

from ai_service.bridge_client import (
    ATTACHMENT_PATH,
    PAGE_CONTENT_PATH,
    PAGES_PATH,
    AttachmentNotFound,
    BridgeClient,
    BridgeError,
    BridgeUnavailable,
    PageNotFound,
)

CONTRACT_PATH = Path(__file__).resolve().parents[2] / "docs" / "contracts" / "ai-bridge.json"
ENDPOINTS: dict[str, dict[str, Any]] = {
    endpoint["path"]: endpoint
    for endpoint in json.loads(CONTRACT_PATH.read_text())["endpoints"]
    if endpoint["side"] == "bridge"
}
TOKEN = "test-service-token"
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
