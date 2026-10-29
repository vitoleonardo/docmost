MARKER_CHARACTERS = frozenset("0123456789, ")
MAX_MARKER_LENGTH = 20


def parse_marker_numbers(inner: str) -> list[int] | None:
    tokens = [token.strip() for token in inner.split(",")]
    if not all(token.isascii() and token.isdigit() for token in tokens):
        return None
    return [int(token) for token in tokens]


class CitationFilter:
    def __init__(self, source_count: int) -> None:
        self.source_count = source_count
        self.pending = ""
        self.display_order: list[int] = []

    def feed(self, delta: str) -> str:
        text = self.pending + delta
        self.pending = ""
        shown: list[str] = []
        position = 0
        while position < len(text):
            opening = text.find("[", position)
            if opening == -1:
                shown.append(text[position:])
                break
            shown.append(text[position:opening])
            end = opening + 1
            while end < len(text) and text[end] in MARKER_CHARACTERS:
                end += 1
            if end == len(text) and end - opening <= MAX_MARKER_LENGTH:
                self.pending = text[opening:]
                break
            numbers = (
                parse_marker_numbers(text[opening + 1 : end])
                if end < len(text) and text[end] == "]"
                else None
            )
            if numbers is None:
                shown.append(text[opening:end])
                position = end
                continue
            shown.append(self.render(numbers))
            position = end + 1
        return "".join(shown)

    def finish(self) -> str:
        remaining = self.pending
        self.pending = ""
        return remaining

    def cited(self) -> list[int]:
        return list(self.display_order)

    def render(self, numbers: list[int]) -> str:
        display_numbers: list[int] = []
        for number in numbers:
            if not 1 <= number <= self.source_count:
                continue
            if number not in self.display_order:
                self.display_order.append(number)
            display_number = self.display_order.index(number) + 1
            if display_number not in display_numbers:
                display_numbers.append(display_number)
        return "".join(f"[{display_number}]" for display_number in display_numbers)
