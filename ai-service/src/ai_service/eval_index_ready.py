import sys
from collections.abc import Callable, Sequence
from typing import Protocol

import psycopg
from psycopg.conninfo import conninfo_to_dict
from pydantic import ValidationError

from ai_service.bridge_client import BridgeError, ListedPage, PageContent, PageListPart
from ai_service.eval_sets import (
    GROUND_TRUTH_FILE,
    SEED_PAGES_FILE,
    contract_truth,
    read_list,
    seed_page_entry,
)
from ai_service.index_store import IndexStore, StoredSection
from ai_service.settings import SEED_CONTENT_DIR
from ai_service.worker import describe_settings_error, load_settings, open_bridge

EXIT_READY = 0
EXIT_NOT_READY = 2

SectionsOf = Callable[[str], list[StoredSection]]


class PageSource(Protocol):
    def list_pages(self, cursor: str | None) -> PageListPart: ...

    def page_content(self, page_id: str) -> PageContent: ...


def has_body_text(markdown: str) -> bool:
    return any(line.strip() and not line.lstrip().startswith("#") for line in markdown.splitlines())


def missing_from_index(
    pages: Sequence[ListedPage],
    contents: dict[str, PageContent],
    sections_of: SectionsOf,
    text_layer_files: set[str],
) -> list[str]:
    missing: list[str] = []
    for page in pages:
        content = contents[page.id]
        sections = sections_of(page.id)
        if has_body_text(content.markdown) and not any(s.attachment_id is None for s in sections):
            missing.append(f"Not searchable: {content.title}")
        indexed_attachments = {s.attachment_id for s in sections}
        for attachment in content.attachments:
            if (
                attachment.file_name in text_layer_files
                and attachment.id not in indexed_attachments
            ):
                missing.append(f"Not searchable: {attachment.file_name} on {content.title}")
    return missing


def list_all_pages(bridge: PageSource) -> list[ListedPage]:
    pages: list[ListedPage] = []
    cursor: str | None = None
    while True:
        part = bridge.list_pages(cursor)
        pages.extend(part.pages)
        if part.next_cursor is None:
            return pages
        cursor = part.next_cursor


def text_layer_pdf_names() -> set[str]:
    contracts = read_list(SEED_CONTENT_DIR, GROUND_TRUTH_FILE, contract_truth)
    pages = read_list(SEED_CONTENT_DIR, SEED_PAGES_FILE, seed_page_entry)
    scanned = {contract.pdf for contract in contracts if not contract.text_layer}
    return {name for page in pages for name in page.attachments} - scanned


def check(bridge: PageSource, sections_of: SectionsOf, text_layer_files: set[str]) -> int:
    pages = list_all_pages(bridge)
    contents = {page.id: bridge.page_content(page.id) for page in pages}
    missing = missing_from_index(pages, contents, sections_of, text_layer_files)
    if missing:
        print("\n".join(missing))
        return EXIT_NOT_READY
    pdfs = sum(
        attachment.file_name in text_layer_files
        for content in contents.values()
        for attachment in content.attachments
    )
    print(f"Index ready: {len(pages)} pages, {pdfs} PDFs")
    return EXIT_READY


def main() -> None:
    try:
        settings = load_settings()
    except ValidationError as error:
        print(describe_settings_error(error), file=sys.stderr)
        sys.exit(EXIT_NOT_READY)
    host = conninfo_to_dict(settings.ai_database_url).get("host")
    try:
        with psycopg.connect(settings.ai_database_url, autocommit=True) as conn:
            sys.exit(
                check(open_bridge(settings), IndexStore(conn).sections_of, text_layer_pdf_names())
            )
    except BridgeError as error:
        print(f"Wiki not reachable at {settings.ai_wiki_url}: {error}", file=sys.stderr)
    except psycopg.Error as error:
        print(f"Database not reachable at {host}: {type(error).__name__}", file=sys.stderr)
    sys.exit(EXIT_NOT_READY)


if __name__ == "__main__":
    main()
