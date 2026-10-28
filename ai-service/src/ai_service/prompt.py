from collections.abc import Sequence

from ai_service.index_store import SearchHit

MAX_HISTORY_TURNS = 5

SYSTEM_PROMPT = (
    "Du bist ein Assistent für ein Wiki. Beantworte die Frage ausschließlich mit den "
    "nummerierten Quellen unten. Antworte auf Deutsch. Kennzeichne jede Aussage mit der "
    "Nummer ihrer Quelle in eckigen Klammern, zum Beispiel [1]. Verwende kein HTML. "
    "Wenn die Quellen die Frage nicht beantworten, sage das kurz."
)


def format_source(number: int, hit: SearchHit) -> str:
    lines = [f"[{number}] {hit.title}"]
    if hit.file_name is not None and hit.pdf_page is not None:
        lines.append(f"Datei: {hit.file_name}, Seite {hit.pdf_page}")
    elif hit.heading_path:
        lines.append(f"Abschnitt: {' › '.join(hit.heading_path)}")
    lines.append(hit.text)
    return "\n".join(lines)


def build_messages(
    question: str,
    sources: Sequence[SearchHit],
    history: Sequence[tuple[str, str | None]],
) -> list[dict[str, str]]:
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for earlier_question, earlier_answer in history[-MAX_HISTORY_TURNS:]:
        messages.append({"role": "user", "content": earlier_question})
        if earlier_answer is not None:
            messages.append({"role": "assistant", "content": earlier_answer})
    blocks = "\n\n".join(format_source(number, hit) for number, hit in enumerate(sources, start=1))
    messages.append({"role": "user", "content": f"Quellen:\n\n{blocks}\n\nFrage: {question}"})
    return messages
