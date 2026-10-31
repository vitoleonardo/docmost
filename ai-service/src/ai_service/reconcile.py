import logging
from dataclasses import dataclass

import psycopg

from ai_service.bridge_client import BridgeClient, BridgeUnavailable, ListedPage
from ai_service.index_store import IndexStore, PageEntry
from ai_service.indexer import Indexer, IndexOutcome
from ai_service.jobs import WriterLock, describe_error

LOGGER = logging.getLogger("ai_service.reconcile")


class ReconcileAborted(Exception):
    def __init__(self, cause: str) -> None:
        super().__init__(cause)
        self.cause = cause


@dataclass(frozen=True)
class ReconcileResult:
    indexed: int
    removed: int
    rescoped: int


@dataclass(frozen=True)
class Differences:
    to_index: list[str]
    to_remove: list[str]
    moves: dict[str, list[str]]


def read_page_list(bridge: BridgeClient) -> dict[str, ListedPage]:
    listed: dict[str, ListedPage] = {}
    cursor: str | None = None
    while True:
        part = bridge.list_pages(cursor)
        listed.update((page.id, page) for page in part.pages)
        if part.next_cursor is None:
            return listed
        cursor = part.next_cursor


def needs_indexing(entry: PageEntry | None, page: ListedPage, embedding_model: str) -> bool:
    return (
        entry is None
        or entry.page_updated_at != page.updated_at
        or entry.embedding_model != embedding_model
    )


def find_differences(
    listed: dict[str, ListedPage], entries: list[PageEntry], embedding_model: str
) -> Differences:
    indexed = {entry.page_id: entry for entry in entries}
    to_index: list[str] = []
    moves: dict[str, list[str]] = {}
    for page in listed.values():
        entry = indexed.get(page.id)
        if needs_indexing(entry, page, embedding_model):
            to_index.append(page.id)
        elif entry is not None and entry.space_id != page.space_id:
            moves.setdefault(page.space_id, []).append(page.id)
    to_remove = [page_id for page_id in indexed if page_id not in listed]
    return Differences(to_index, to_remove, moves)


def reconcile(
    bridge: BridgeClient,
    store: IndexStore,
    indexer: Indexer,
    embedding_model: str,
    writer_lock: WriterLock,
    logger: logging.Logger = LOGGER,
) -> ReconcileResult:
    with writer_lock():
        try:
            listed = read_page_list(bridge)
        except Exception as error:
            cause = describe_error(error)
            logger.warning("Reconcile aborted, the page list could not be read: %s", cause)
            raise ReconcileAborted(cause) from error
        differences = find_differences(listed, store.list_entries(), embedding_model)
        result = apply_differences(differences, store, indexer, logger)
    logger.info(
        "Reconcile finished: %d indexed, %d removed, %d rescoped",
        result.indexed,
        result.removed,
        result.rescoped,
    )
    return result


def apply_differences(
    differences: Differences, store: IndexStore, indexer: Indexer, logger: logging.Logger
) -> ReconcileResult:
    if differences.to_remove:
        store.remove_pages(differences.to_remove)
    for space_id, page_ids in differences.moves.items():
        store.rescope(page_ids, space_id)
    outcomes = [index_listed_page(indexer, page_id, logger) for page_id in differences.to_index]
    return ReconcileResult(
        indexed=outcomes.count(IndexOutcome.INDEXED),
        removed=len(differences.to_remove) + outcomes.count(IndexOutcome.REMOVED),
        rescoped=sum(len(page_ids) for page_ids in differences.moves.values()),
    )


def index_listed_page(
    indexer: Indexer, page_id: str, logger: logging.Logger
) -> IndexOutcome | None:
    try:
        return indexer.index_page(page_id)
    except BridgeUnavailable as error:
        logger.warning("Reconcile aborted at page %s: %s", page_id, error.cause)
        raise ReconcileAborted(error.cause) from error
    except psycopg.OperationalError:
        raise
    except Exception as error:
        logger.warning(
            "Reconcile could not index page %s, next reconcile tries again: %s",
            page_id,
            describe_error(error),
        )
        return None
