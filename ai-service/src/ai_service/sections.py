import io
import re
from dataclasses import dataclass

from pypdf import PdfReader

MAX_SECTION_CHARS = 1500
MAX_PDF_PAGES = 300
MAX_PDF_BYTES = 20_971_520

HEADING = re.compile(r"^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$")
FENCE = re.compile(r"^\s*(`{3,}|~{3,})")
SPLITTERS = (
    (re.compile(r"\n\s*\n"), "\n\n"),
    (re.compile(r"(?<=[.!?])\s+"), " "),
    (re.compile(r"\s+"), " "),
)


@dataclass(frozen=True)
class Section:
    heading_path: tuple[str, ...]
    text: str


@dataclass(frozen=True)
class PdfSection:
    pdf_page: int
    text: str


class PdfSkipped(Exception):
    def __init__(self, reason: str, page_count: int | None = None):
        super().__init__(reason)
        self.reason = reason
        self.page_count = page_count


def split_text(text: str, level: int = 0) -> list[str]:
    text = text.strip()
    if len(text) <= MAX_SECTION_CHARS:
        return [text] if text else []
    if level == len(SPLITTERS):
        return [text[i : i + MAX_SECTION_CHARS] for i in range(0, len(text), MAX_SECTION_CHARS)]
    splitter, separator = SPLITTERS[level]
    pieces: list[str] = []
    current = ""
    for part in splitter.split(text):
        for unit in split_text(part, level + 1):
            if current and len(current) + len(separator) + len(unit) <= MAX_SECTION_CHARS:
                current += separator + unit
                continue
            if current:
                pieces.append(current)
            current = unit
    if current:
        pieces.append(current)
    return pieces


def heading_path_after(
    stack: list[tuple[int, str]], level: int, title: str
) -> list[tuple[int, str]]:
    kept = [entry for entry in stack if entry[0] < level]
    return [*kept, (level, title)]


def markdown_sections(markdown: str) -> list[Section]:
    sections: list[Section] = []
    stack: list[tuple[int, str]] = []
    lines: list[str] = []
    open_fence: str | None = None

    def flush() -> None:
        path = tuple(title for _, title in stack)
        sections.extend(Section(path, piece) for piece in split_text("\n".join(lines)))
        lines.clear()

    for line in markdown.splitlines():
        fence = FENCE.match(line)
        if fence and open_fence is None:
            open_fence = fence.group(1)[0]
        elif fence and fence.group(1)[0] == open_fence:
            open_fence = None
        heading = None if open_fence else HEADING.match(line)
        if not heading:
            lines.append(line)
            continue
        flush()
        stack = heading_path_after(stack, len(heading.group(1)), (heading.group(2) or "").strip())
    flush()
    return sections


def read_pdf_pages(pdf_bytes: bytes) -> list[str]:
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        if len(reader.pages) > MAX_PDF_PAGES:
            raise PdfSkipped(f"more than {MAX_PDF_PAGES} pages", len(reader.pages))
        return [page.extract_text() or "" for page in reader.pages]
    except PdfSkipped:
        raise
    except Exception as error:
        raise PdfSkipped("unreadable PDF") from error


def pdf_sections(pdf_bytes: bytes) -> list[PdfSection]:
    pages = read_pdf_pages(pdf_bytes)
    sections = [
        PdfSection(number, piece)
        for number, text in enumerate(pages, start=1)
        for piece in split_text(text)
    ]
    if not sections:
        raise PdfSkipped("no text layer")
    return sections
