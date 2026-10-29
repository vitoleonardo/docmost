import re
from collections.abc import Mapping, Set
from dataclasses import dataclass
from typing import Any, Literal

MAX_REASON_LENGTH = 500
MAX_NEW_TEXT_LENGTH = 2000
MAX_CHANGES = 10

TOKEN_PATTERN = re.compile(r"\s+|\S+")

OpKind = Literal["keep", "remove", "add"]


@dataclass(frozen=True)
class Block:
    number: int
    text: str
    heading: str | None
    editable: bool


@dataclass(frozen=True)
class PageRead:
    page_id: str
    title: str
    fingerprint: str
    blocks: tuple[Block, ...]


@dataclass(frozen=True)
class DiffOp:
    op: OpKind
    text: str


@dataclass(frozen=True)
class Change:
    block: int
    heading: str | None
    old_text: str
    new_text: str
    ops: tuple[DiffOp, ...]

    def to_json(self) -> dict[str, Any]:
        return {
            "block": self.block,
            "heading": self.heading,
            "oldText": self.old_text,
            "newText": self.new_text,
            "ops": [{"op": op.op, "text": op.text} for op in self.ops],
        }


@dataclass(frozen=True)
class ProposalDraft:
    page_id: str
    page_title: str
    fingerprint: str
    reason: str
    changes: tuple[Change, ...]
    added: int
    removed: int

    def to_json(self) -> dict[str, Any]:
        return {
            "pageId": self.page_id,
            "pageTitle": self.page_title,
            "fingerprint": self.fingerprint,
            "reason": self.reason,
            "changes": [change.to_json() for change in self.changes],
            "added": self.added,
            "removed": self.removed,
        }


class ProposalRefused(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def tokenize(text: str) -> list[str]:
    return TOKEN_PATTERN.findall(text)


def words(text: str) -> list[str]:
    return text.split()


def lcs_table(old: list[str], new: list[str]) -> list[list[int]]:
    table = [[0] * (len(new) + 1) for _ in range(len(old) + 1)]
    for i in range(len(old) - 1, -1, -1):
        for j in range(len(new) - 1, -1, -1):
            if old[i] == new[j]:
                table[i][j] = table[i + 1][j + 1] + 1
            else:
                table[i][j] = max(table[i + 1][j], table[i][j + 1])
    return table


def diff_words(old_text: str, new_text: str) -> tuple[DiffOp, ...]:
    old = tokenize(old_text)
    new = tokenize(new_text)
    table = lcs_table(old, new)
    removed_run: list[str] = []
    added_run: list[str] = []
    ops: list[DiffOp] = []

    def flush_runs() -> None:
        if removed_run:
            ops.append(DiffOp("remove", "".join(removed_run)))
        if added_run:
            ops.append(DiffOp("add", "".join(added_run)))
        removed_run.clear()
        added_run.clear()

    i = j = 0
    while i < len(old) or j < len(new):
        if i < len(old) and j < len(new) and old[i] == new[j]:
            flush_runs()
            token = old[i]
            if ops and ops[-1].op == "keep":
                ops[-1] = DiffOp("keep", ops[-1].text + token)
            else:
                ops.append(DiffOp("keep", token))
            i += 1
            j += 1
        elif j < len(new) and (i == len(old) or table[i][j + 1] >= table[i + 1][j]):
            added_run.append(new[j])
            j += 1
        else:
            removed_run.append(old[i])
            i += 1
    flush_runs()
    return merge_regions(ops)


def merge_regions(ops: list[DiffOp]) -> tuple[DiffOp, ...]:
    merged: list[DiffOp] = []
    removed: list[str] = []
    added: list[str] = []

    def flush() -> None:
        if removed:
            merged.append(DiffOp("remove", "".join(removed)))
        if added:
            merged.append(DiffOp("add", "".join(added)))
        removed.clear()
        added.clear()

    for index, op in enumerate(ops):
        is_gap = (
            op.op == "keep"
            and not op.text.strip()
            and 0 < index < len(ops) - 1
            and ops[index - 1].op != "keep"
            and ops[index + 1].op != "keep"
        )
        if op.op == "remove" or is_gap:
            removed.append(op.text)
        if op.op == "add" or is_gap:
            added.append(op.text)
        if op.op == "keep" and not is_gap:
            flush()
            merged.append(op)
    flush()
    return tuple(merged)


def count_words(ops: tuple[DiffOp, ...], kind: OpKind) -> int:
    return sum(len(words(op.text)) for op in ops if op.op == kind)


def refuse(reason: str) -> ProposalRefused:
    return ProposalRefused(reason)


def validate_change(raw: Any, blocks: Mapping[int, Block]) -> tuple[Block, str]:
    if not isinstance(raw, dict):
        raise refuse("Jede Änderung braucht die Felder block und newText.")
    number = raw.get("block")
    new_text = raw.get("newText")
    if isinstance(number, bool) or not isinstance(number, int):
        raise refuse("Das Feld block muss eine ganze Zahl sein.")
    if not isinstance(new_text, str):
        raise refuse(f"Das Feld newText von Block {number} muss ein Text sein.")
    block = blocks.get(number)
    if block is None:
        raise refuse(f"Block {number} gibt es in der letzten Lesung dieser Seite nicht.")
    if not block.editable:
        raise refuse(f"Block {number} enthält mehr als Text und kann nicht geändert werden.")
    if not new_text.strip():
        raise refuse(f"Der neue Text von Block {number} ist leer.")
    if len(new_text) > MAX_NEW_TEXT_LENGTH:
        raise refuse(
            f"Der neue Text von Block {number} ist länger als {MAX_NEW_TEXT_LENGTH} Zeichen."
        )
    if words(new_text) == words(block.text):
        raise refuse(f"Der neue Text von Block {number} hat dieselben Wörter wie der alte.")
    return block, new_text


def build_proposal(
    page_id: Any,
    reason: Any,
    changes: Any,
    reads: Mapping[str, PageRead],
    already_proposed: Set[str],
) -> ProposalDraft:
    read = reads.get(page_id) if isinstance(page_id, str) else None
    if read is None:
        raise refuse("Diese Seite wurde in diesem Lauf nicht gelesen. Lies sie zuerst.")
    if page_id in already_proposed:
        raise refuse("Für diese Seite gibt es in diesem Lauf schon einen Vorschlag.")
    if not isinstance(reason, str) or not reason.strip():
        raise refuse("Die Begründung fehlt.")
    if len(reason.strip()) > MAX_REASON_LENGTH:
        raise refuse(f"Die Begründung ist länger als {MAX_REASON_LENGTH} Zeichen.")
    if not isinstance(changes, list) or not 1 <= len(changes) <= MAX_CHANGES:
        raise refuse(f"Ein Vorschlag braucht 1 bis {MAX_CHANGES} Änderungen.")

    blocks = {block.number: block for block in read.blocks}
    seen: set[int] = set()
    accepted: list[Change] = []
    for raw in changes:
        block, new_text = validate_change(raw, blocks)
        if block.number in seen:
            raise refuse(f"Block {block.number} wird mehrfach geändert.")
        seen.add(block.number)
        accepted.append(
            Change(
                block=block.number,
                heading=block.heading,
                old_text=block.text,
                new_text=new_text,
                ops=diff_words(block.text, new_text),
            )
        )

    return ProposalDraft(
        page_id=read.page_id,
        page_title=read.title,
        fingerprint=read.fingerprint,
        reason=reason,
        changes=tuple(accepted),
        added=sum(count_words(change.ops, "add") for change in accepted),
        removed=sum(count_words(change.ops, "remove") for change in accepted),
    )
