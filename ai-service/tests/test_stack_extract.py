import io
import logging
import os
import time
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

import httpx
import psycopg
import pytest
from psycopg import sql
from pypdf import PdfReader, PdfWriter
from redis import Redis

from ai_service.bridge_client import BridgeClient
from ai_service.eval_cases import unwrap_data
from ai_service.extraction import Extracted, ExtractionPipeline
from ai_service.inference import ChatModel
from ai_service.settings import AskSettings
from ai_service.wiki_session import SEED_EMAILS
from ai_service.wiki_session import log_in as log_in_with_retry
from tests.conftest import USER_ID, WORKSPACE_ID, RecordingRequestLog
from tests.test_stack import SEED_GENERATED, list_all_pages, pdf_file_names_by_text_layer

pytestmark = [pytest.mark.integration, pytest.mark.stack]

STACK_VARIABLES = [
    "STACK_WIKI_URL",
    "STACK_AI_DATABASE_URL",
    "STACK_SERVICE_TOKEN",
    "STACK_REDIS_URL",
]
SEED_PASSWORD = os.environ.get("STACK_SEED_PASSWORD", "seed-demo-password")
PDF_MIME_TYPE = "application/pdf"
CUSTOMER_TITLE = "Kundenvertrag Stadtwerke Beispielstadt"
CUSTOMER_FILE = "kundenvertrag-stadtwerke-beispielstadt.pdf"
SUBCONTRACTOR_TITLE = "Subunternehmervertrag Tiefbau"
CUSTOMER_VALUE = "1.200.000,00"
CUSTOMER_PARTY = "Stadtwerke Beispielstadt"
SECONDS_PER_REQUEST = 40
SECONDS_FOR_TEN_PAGES = 180
COMBINED_PAGE_COUNT = 10
REQUEST_TIMEOUT_SECONDS = 210
AI_SCHEMA = "ai"


@dataclass(frozen=True)
class Contract:
    page_id: str
    page_title: str
    attachment_id: str
    file_name: str


@dataclass(frozen=True)
class Extraction:
    contract: Contract
    body: dict[str, Any]
    seconds: float

    def field(self, key: str) -> dict[str, Any]:
        [entry] = [item for item in self.body["fields"] if item["key"] == key]
        return entry


@dataclass(frozen=True)
class Traces:
    database: set[str]
    redis: set[str]


@dataclass(frozen=True)
class ExtractionRuns:
    extractions: dict[str, Extraction]
    new_traces: Traces


def text_contract_file_names() -> set[str]:
    with_text, _ = pdf_file_names_by_text_layer()
    return {name for name in with_text if "vertrag" in name}


def require_stack_variables() -> dict[str, str]:
    missing = [name for name in STACK_VARIABLES if not os.environ.get(name)]
    if missing:
        pytest.fail(f"no running stack configured, set {', '.join(missing)}")
    return {name: os.environ[name] for name in STACK_VARIABLES}


def find_contracts(wiki_url: str, service_token: str) -> list[Contract]:
    bridge = BridgeClient(wiki_url, service_token)
    contents = [bridge.page_content(page.id) for page in list_all_pages(bridge)]
    return [
        Contract(content.id, content.title, attachment.id, attachment.file_name)
        for content in contents
        for attachment in content.attachments
        if attachment.mime_type == PDF_MIME_TYPE
    ]


def contract_titled(contracts: list[Contract], title: str) -> Contract:
    [contract] = [item for item in contracts if item.page_title == title]
    return contract


def extract_through_wiki(session: httpx.Client, contract: Contract) -> Extraction:
    started = time.monotonic()
    response = session.post(
        "/api/ai/extract",
        json={"pageId": contract.page_id, "attachmentId": contract.attachment_id},
    )
    seconds = time.monotonic() - started
    assert response.status_code == 200, response.text
    body = unwrap_data(response.json())
    assert body["outcome"] == "extracted", body
    return Extraction(contract, body, seconds)


def database_rows(conn: psycopg.Connection) -> set[str]:
    tables = conn.execute(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = %s", (AI_SCHEMA,)
    ).fetchall()
    rows: set[str] = set()
    for (table,) in tables:
        query = sql.SQL("SELECT t::text FROM {}.{} AS t").format(
            sql.Identifier(AI_SCHEMA), sql.Identifier(table)
        )
        rows.update(f"{table} {row[0]}" for row in conn.execute(query).fetchall())
    return rows


def redis_entries(redis: Redis) -> set[str]:
    entries: set[str] = set()
    for key in redis.scan_iter(count=1000):
        kind = redis.type(key)
        if kind == "string":
            content = redis.get(key)
        elif kind == "hash":
            content = redis.hgetall(key)
        elif kind == "list":
            content = redis.lrange(key, 0, -1)
        elif kind == "set":
            content = sorted(redis.smembers(key))
        elif kind == "zset":
            content = redis.zrange(key, 0, -1, withscores=True)
        elif kind == "stream":
            content = redis.xrange(key)
        else:
            content = None
        entries.add(f"{key} {kind} {content}")
    return entries


def take_traces(conn: psycopg.Connection, redis: Redis) -> Traces:
    return Traces(database_rows(conn), redis_entries(redis))


@pytest.fixture(scope="module")
def variables() -> dict[str, str]:
    return require_stack_variables()


@pytest.fixture(scope="module")
def session(variables: dict[str, str]) -> Iterator[httpx.Client]:
    with httpx.Client(
        base_url=variables["STACK_WIKI_URL"], timeout=REQUEST_TIMEOUT_SECONDS
    ) as client:
        response = log_in_with_retry(client, SEED_EMAILS["GF"], SEED_PASSWORD, time.sleep)
        assert response.status_code == 200, response.text
        yield client


@pytest.fixture(scope="module")
def contracts(variables: dict[str, str]) -> list[Contract]:
    return find_contracts(variables["STACK_WIKI_URL"], variables["STACK_SERVICE_TOKEN"])


@pytest.fixture(scope="module")
def text_contracts(contracts: list[Contract]) -> list[Contract]:
    names = text_contract_file_names()
    chosen = [item for item in contracts if item.file_name in names]
    assert {item.file_name for item in chosen} == names
    assert len(chosen) == 6
    return chosen


@pytest.fixture(scope="module")
def runs(
    variables: dict[str, str], session: httpx.Client, text_contracts: list[Contract]
) -> Iterator[ExtractionRuns]:
    redis = Redis.from_url(variables["STACK_REDIS_URL"], decode_responses=True)
    with psycopg.connect(variables["STACK_AI_DATABASE_URL"], autocommit=True) as conn:
        extract_through_wiki(session, text_contracts[0])
        before = take_traces(conn, redis)
        extractions = {
            item.file_name: extract_through_wiki(session, item) for item in text_contracts
        }
        after = take_traces(conn, redis)
    redis.close()
    yield ExtractionRuns(
        extractions,
        Traces(after.database - before.database, after.redis - before.redis),
    )


def test_extract_ac55_the_customer_contract_value_is_found_with_the_local_model(
    runs: ExtractionRuns,
):
    value = runs.extractions[CUSTOMER_FILE].field("value")
    assert value["value"] is not None
    assert CUSTOMER_VALUE in value["value"]
    assert value["quote"] and value["pdfPage"]


def test_extract_ac56_the_subcontractor_contract_renewal_is_not_found(
    runs: ExtractionRuns, contracts: list[Contract]
):
    contract = contract_titled(contracts, SUBCONTRACTOR_TITLE)
    renewal = runs.extractions[contract.file_name].field("renewal")
    assert renewal == {"key": "renewal", "value": None, "quote": None, "pdfPage": None}


def test_extract_ac57_each_text_contract_is_extracted_through_the_wiki_in_40_seconds(
    runs: ExtractionRuns,
):
    assert len(runs.extractions) == 6
    for file_name, extraction in sorted(runs.extractions.items()):
        print(f"EXTRACT-AC57 {file_name}: {extraction.seconds:.1f} s")
    slow = {
        file_name: round(extraction.seconds, 1)
        for file_name, extraction in runs.extractions.items()
        if extraction.seconds > SECONDS_PER_REQUEST
    }
    assert slow == {}


def test_extract_ac52_no_value_or_quote_is_left_in_the_ai_database_or_redis(runs: ExtractionRuns):
    leaked_texts = {
        text
        for extraction in runs.extractions.values()
        for entry in extraction.body["fields"]
        for text in (entry["value"], entry["quote"])
        if text
    }
    assert len(leaked_texts) >= 6
    found_in = {
        place: sorted(text for text in leaked_texts if any(text in row for row in rows))
        for place, rows in (
            ("database", runs.new_traces.database),
            ("redis", runs.new_traces.redis),
        )
    }
    assert found_in == {"database": [], "redis": []}


def combined_seed_pdf() -> bytes:
    others = sorted(text_contract_file_names() - {CUSTOMER_FILE})[: COMBINED_PAGE_COUNT // 2 - 1]
    writer = PdfWriter()
    for file_name in [CUSTOMER_FILE, *others]:
        writer.append(PdfReader(SEED_GENERATED / file_name))
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def test_extract_ac68_a_ten_page_pdf_of_five_contracts_names_the_customer_as_party(
    caplog: pytest.LogCaptureFixture,
):
    base_url = os.environ.get(
        "STACK_LLM_BASE_URL", str(AskSettings.model_fields["ai_llm_base_url"].default)
    )
    model_name = os.environ.get(
        "STACK_LLM_MODEL", str(AskSettings.model_fields["ai_llm_model"].default)
    )
    pdf = combined_seed_pdf()
    assert len(PdfReader(io.BytesIO(pdf)).pages) == COMBINED_PAGE_COUNT
    pipeline = ExtractionPipeline(
        fetch_attachment=lambda _: pdf,
        model=ChatModel(base_url, model_name),
        mode="local",
        model_name=model_name,
        request_log=RecordingRequestLog(),
    )
    caplog.set_level(logging.INFO, logger="ai_service.extraction")
    started = time.monotonic()
    result = pipeline.extract(
        "00000000-0000-4000-8000-000000000068", len(pdf), USER_ID, WORKSPACE_ID
    )
    seconds = time.monotonic() - started
    print(f"EXTRACT-AC68 {base_url}: {seconds:.1f} s")
    log_lines = [record.getMessage() for record in caplog.records]
    assert isinstance(result, Extracted), (result, log_lines)
    assert seconds < SECONDS_FOR_TEN_PAGES
    [parties] = [item for item in result.fields if item.key == "parties"]
    assert parties.value is not None and CUSTOMER_PARTY in parties.value
