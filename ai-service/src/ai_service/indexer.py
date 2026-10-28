import logging
from collections.abc import Sequence
from dataclasses import dataclass, replace
from enum import StrEnum

from ai_service.bridge_client import (
    AttachmentInfo,
    AttachmentNotFound,
    BridgeClient,
    PageContent,
    PageNotFound,
)
from ai_service.embedding import Embedder
from ai_service.index_store import IndexStore, PageEntry, StoredSection
from ai_service.sections import MAX_PDF_BYTES, PdfSkipped, markdown_sections, pdf_sections

LOGGER = logging.getLogger("ai_service.indexer")


class IndexOutcome(StrEnum):
    INDEXED = "indexed"
    REMOVED = "removed"
    KEPT_NEWER = "kept-newer"


def search_text(
    title: str, heading_path: Sequence[str], text: str, file_name: str | None = None
) -> str:
    context = list(heading_path) if file_name is None else [file_name]
    return "\n".join([title, *context, text])


@dataclass(frozen=True)
class PendingSection:
    heading_path: list[str]
    text: str
    search_text: str
    attachment_id: str | None = None
    file_name: str | None = None
    pdf_page: int | None = None


def to_embed_again(title: str, sections: list[StoredSection]) -> list[PendingSection]:
    return [
        PendingSection(
            section.heading_path,
            section.text,
            search_text(title, section.heading_path, section.text, section.file_name),
            section.attachment_id,
            section.file_name,
            section.pdf_page,
        )
        for section in sections
    ]


class Indexer:
    def __init__(
        self,
        bridge: BridgeClient,
        store: IndexStore,
        embedder: Embedder,
        logger: logging.Logger = LOGGER,
    ) -> None:
        self._bridge = bridge
        self._store = store
        self._embedder = embedder
        self._logger = logger

    def index_page(self, page_id: str) -> IndexOutcome:
        try:
            content = self._bridge.page_content(page_id)
        except PageNotFound:
            self._store.remove_pages([page_id])
            self._logger.info("Page %s is gone from the wiki, removed from the index", page_id)
            return IndexOutcome.REMOVED
        ordered: list[PendingSection | list[StoredSection]] = [
            PendingSection(
                list(section.heading_path),
                section.text,
                search_text(content.title, section.heading_path, section.text),
            )
            for section in markdown_sections(content.markdown)
        ]
        ordered.extend(self._pdf_parts(content))
        sections = self._embed_and_number(ordered)
        entry = PageEntry(
            page_id=content.id,
            workspace_id=content.workspace_id,
            space_id=content.space_id,
            title=content.title,
            page_updated_at=content.updated_at,
            embedding_model=self._embedder.model_name,
        )
        if not self._store.replace_page(entry, sections):
            self._logger.info("Page %s: index holds a newer version, kept", page_id)
            return IndexOutcome.KEPT_NEWER
        self._logger.info("Page %s indexed with %d sections", page_id, len(sections))
        return IndexOutcome.INDEXED

    def _pdf_parts(self, content: PageContent) -> list[PendingSection | list[StoredSection]]:
        reusable = self._store.pdf_sections_for(
            content.id,
            [attachment.id for attachment in content.attachments],
            self._embedder.model_name,
        )
        stored = self._store.get_entry(content.id) if reusable else None
        retitled = stored is not None and stored.title != content.title
        parts: list[PendingSection | list[StoredSection]] = []
        for attachment in content.attachments:
            reused = reusable.get(attachment.id)
            if reused is None:
                parts.extend(self._new_pdf_sections(content.id, content.title, attachment))
            elif retitled:
                parts.extend(to_embed_again(content.title, reused))
            else:
                parts.append(reused)
        return parts

    def _new_pdf_sections(
        self, page_id: str, title: str, attachment: AttachmentInfo
    ) -> list[PendingSection]:
        if attachment.file_size > MAX_PDF_BYTES:
            self._logger.warning(
                "Page %s: PDF %s skipped, %d bytes is over the size limit of %d bytes",
                page_id,
                attachment.id,
                attachment.file_size,
                MAX_PDF_BYTES,
            )
            return []
        try:
            data = self._bridge.attachment(attachment.id)
        except AttachmentNotFound:
            self._logger.warning(
                "Page %s: PDF %s skipped, the bridge answered attachment_not_found",
                page_id,
                attachment.id,
            )
            return []
        try:
            parsed = pdf_sections(data)
        except PdfSkipped as skipped:
            self._logger.warning(
                "Page %s: PDF %s skipped, %s", page_id, attachment.id, skipped.reason
            )
            return []
        return [
            PendingSection(
                [],
                section.text,
                search_text(title, [], section.text, attachment.file_name),
                attachment.id,
                attachment.file_name,
                section.pdf_page,
            )
            for section in parsed
        ]

    def _embed_and_number(
        self, ordered: list[PendingSection | list[StoredSection]]
    ) -> list[StoredSection]:
        pending = [item for item in ordered if isinstance(item, PendingSection)]
        vectors = iter(
            self._embedder.embed([item.search_text for item in pending]) if pending else []
        )
        flat: list[StoredSection] = []
        for item in ordered:
            if isinstance(item, PendingSection):
                flat.append(
                    StoredSection(
                        0,
                        item.heading_path,
                        item.text,
                        next(vectors),
                        item.attachment_id,
                        item.file_name,
                        item.pdf_page,
                    )
                )
            else:
                flat.extend(item)
        return [replace(section, position=position) for position, section in enumerate(flat)]
