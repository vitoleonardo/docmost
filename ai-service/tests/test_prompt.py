from ai_service.index_store import SearchHit
from ai_service.prompt import build_messages


def hit(
    title: str,
    text: str,
    heading_path: list[str] | None = None,
    file_name: str | None = None,
    pdf_page: int | None = None,
) -> SearchHit:
    return SearchHit(
        page_id="p",
        title=title,
        space_id="s",
        heading_path=heading_path or [],
        text=text,
        score=0.9,
        attachment_id=None,
        file_name=file_name,
        pdf_page=pdf_page,
    )


def test_ask_ac16_system_message_is_first_and_german() -> None:
    messages = build_messages("Frage?", [hit("Titel", "Text")], [])
    assert messages[0]["role"] == "system"
    system = messages[0]["content"]
    assert "Deutsch" in system
    assert "[1]" in system
    assert "HTML" in system


def test_ask_ac16_sources_are_numbered_with_heading_path_and_pdf_location() -> None:
    sources = [
        hit("Reisekosten", "Bahn erstattet.", ["Regeln", "Bahn"]),
        hit("Handbuch", "Seite Text.", file_name="handbuch.pdf", pdf_page=4),
        hit("Ohne", "Nur Text."),
    ]
    messages = build_messages("Wie?", sources, [])
    content = messages[-1]["content"]
    assert "[1] Reisekosten\nAbschnitt: Regeln › Bahn\nBahn erstattet." in content
    assert "[2] Handbuch\nDatei: handbuch.pdf, Seite 4\nSeite Text." in content
    assert "[3] Ohne\nNur Text." in content
    assert "Abschnitt:" not in content.split("[3] Ohne")[1]


def test_ask_ac16_question_is_last_in_the_final_user_message() -> None:
    messages = build_messages("Wie viel?", [hit("T", "x")], [])
    assert messages[-1]["role"] == "user"
    assert messages[-1]["content"].rstrip().endswith("Wie viel?")
    assert len(messages) == 2


def test_ask_ac46_history_turn_precedes_the_question() -> None:
    messages = build_messages("Zweite?", [hit("T", "x")], [("Erste?", "Antwort 1 [1]")])
    assert [message["role"] for message in messages] == [
        "system",
        "user",
        "assistant",
        "user",
    ]
    assert messages[1]["content"] == "Erste?"
    assert messages[2]["content"] == "Antwort 1 [1]"


def test_ask_ac47_only_the_last_five_turns_are_kept_in_order() -> None:
    history = [(f"Q{index}", f"A{index}") for index in range(1, 7)]
    messages = build_messages("Q7", [hit("T", "x")], history)
    contents = [message["content"] for message in messages[1:-1]]
    assert contents == ["Q2", "A2", "Q3", "A3", "Q4", "A4", "Q5", "A5", "Q6", "A6"]
    assert all("Q1" != content for content in contents)
