import json
import uuid
from dataclasses import dataclass
from pathlib import Path

from ai_service.sections import markdown_sections

SEED_CONTENT = (
    Path(__file__).resolve().parents[2]
    / "apps"
    / "server"
    / "src"
    / "integrations"
    / "seed"
    / "content"
)
PAGES_DIR = SEED_CONTENT / "pages"
CANARIES_PATH = SEED_CONTENT / "generated" / "canaries.json"
LEAK_QUESTIONS_PATH = SEED_CONTENT / "leak-questions.json"
CANARY_QUESTIONS_PATH = SEED_CONTENT / "canary-questions.json"
LEAK_INJECTION_PAGES_PATH = SEED_CONTENT / "leak-injection-pages.json"
SEED_NAMESPACE = uuid.UUID("0192f000-0000-7000-8000-00000000feed")

SPACE_DIRS = ("allgemein", "hr", "vertrieb", "projekte", "it", "geschaeftsfuehrung")
SEED_USERS = ("GF", "PL", "VT", "WS")
SPACE_MEMBERS: dict[str, frozenset[str]] = {
    "GF": frozenset(SPACE_DIRS),
    "PL": frozenset({"allgemein", "hr", "projekte", "it"}),
    "VT": frozenset({"allgemein", "vertrieb", "projekte"}),
    "WS": frozenset({"allgemein", "projekte", "it"}),
}


def seed_id(name: str) -> str:
    return str(uuid.uuid5(SEED_NAMESPACE, name))


def space_id_of(space_dir: str) -> str:
    return seed_id(f"space:{space_dir}")


@dataclass(frozen=True)
class SeedPage:
    page_id: str
    space_dir: str
    title: str
    markdown: str
    canary: str | None
    denied_users: frozenset[str]

    @property
    def space_id(self) -> str:
        return space_id_of(self.space_dir)

    def section_texts(self) -> list[str]:
        return [section.text for section in markdown_sections(self.markdown)]

    def viewable_by(self, user: str) -> bool:
        return self.space_dir in SPACE_MEMBERS[user] and user not in self.denied_users


def load_seed_pages() -> list[SeedPage]:
    canaries = json.loads(CANARIES_PATH.read_text())
    pages: list[SeedPage] = []
    matched: set[str] = set()
    for space_dir in SPACE_DIRS:
        for path in sorted((PAGES_DIR / space_dir).glob("*.md")):
            markdown = path.read_text()
            entries = [entry for entry in canaries if entry["canary"] in markdown]
            assert len(entries) <= 1, f"{path.name} holds more than one canary"
            entry = entries[0] if entries else None
            if entry is not None:
                matched.add(entry["canary"])
            pages.append(
                SeedPage(
                    page_id=seed_id(f"page:{space_dir}/{path.stem}"),
                    space_dir=space_dir,
                    title=entry["title"] if entry else path.stem,
                    markdown=markdown,
                    canary=entry["canary"] if entry else None,
                    denied_users=frozenset(entry["deniedUsers"]) if entry else frozenset(),
                )
            )
    assert matched == {entry["canary"] for entry in canaries}, "a canary has no seed page"
    return pages


def member_space_ids(user: str) -> list[str]:
    return [space_id_of(space_dir) for space_dir in SPACE_DIRS if space_dir in SPACE_MEMBERS[user]]
