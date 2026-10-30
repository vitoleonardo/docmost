from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

LOCAL_MODE = "local"
TOKENS_PER_PRICE_UNIT = Decimal(1_000_000)
COST_PRECISION = Decimal("0.000001")
PRICING_SOURCE_URL = "https://platform.claude.com/docs/en/about-claude/pricing"
PRICING_READ_ON = date(2026, 10, 30)


@dataclass(frozen=True)
class Price:
    model: str
    prompt_usd_per_mtok: Decimal
    completion_usd_per_mtok: Decimal
    valid_from: date
    source_url: str
    read_on: date


PRICES: tuple[Price, ...] = (
    Price(
        model="claude-sonnet-5-5",
        prompt_usd_per_mtok=Decimal("2"),
        completion_usd_per_mtok=Decimal("10"),
        valid_from=PRICING_READ_ON,
        source_url=PRICING_SOURCE_URL,
        read_on=PRICING_READ_ON,
    ),
    Price(
        model="claude-haiku-5-5",
        prompt_usd_per_mtok=Decimal("0.10"),
        completion_usd_per_mtok=Decimal("0.50"),
        valid_from=PRICING_READ_ON,
        source_url=PRICING_SOURCE_URL,
        read_on=PRICING_READ_ON,
    ),
)


def price_on(prices: Sequence[Price], model: str, day: date) -> Price | None:
    applicable = [entry for entry in prices if entry.model == model and entry.valid_from <= day]
    return max(applicable, key=lambda entry: entry.valid_from, default=None)


def request_cost(
    prices: Sequence[Price],
    mode: str,
    model: str,
    day: date,
    prompt_tokens: int | None,
    completion_tokens: int | None,
) -> Decimal | None:
    if mode == LOCAL_MODE:
        return Decimal(0)
    entry = price_on(prices, model, day)
    if entry is None or prompt_tokens is None or completion_tokens is None:
        return None
    cost = (
        prompt_tokens * entry.prompt_usd_per_mtok
        + completion_tokens * entry.completion_usd_per_mtok
    ) / TOKENS_PER_PRICE_UNIT
    return cost.quantize(COST_PRECISION, rounding=ROUND_HALF_UP)
