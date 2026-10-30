from datetime import date
from decimal import Decimal

import pytest

from ai_service.prices import LOCAL_MODE, PRICES, Price, request_cost

MODEL = "claude-test"
DAY = date(2026, 10, 30)


def price(prompt: str, completion: str, valid_from: date, model: str = MODEL) -> Price:
    return Price(
        model=model,
        prompt_usd_per_mtok=Decimal(prompt),
        completion_usd_per_mtok=Decimal(completion),
        valid_from=valid_from,
        source_url="https://example.test/pricing",
        read_on=valid_from,
    )


OCTOBER_ENTRY = price("3", "15", date(2026, 10, 1))


def test_reqlog_ac28_local_mode_without_entry_costs_zero() -> None:
    assert request_cost([], LOCAL_MODE, MODEL, DAY, 1_200, 300) == Decimal(0)


def test_reqlog_ac28_local_mode_with_entry_costs_zero() -> None:
    assert request_cost([OCTOBER_ENTRY], LOCAL_MODE, MODEL, DAY, 1_200, 300) == Decimal(0)


def test_reqlog_ac28_local_mode_value_is_the_settings_default() -> None:
    assert LOCAL_MODE == "local"


@pytest.mark.parametrize(
    ("prompt_tokens", "completion_tokens"), [(None, None), (None, 300), (1_200, None)]
)
def test_reqlog_ac51_local_mode_with_empty_tokens_costs_zero(
    prompt_tokens: int | None, completion_tokens: int | None
) -> None:
    cost = request_cost([OCTOBER_ENTRY], LOCAL_MODE, MODEL, DAY, prompt_tokens, completion_tokens)
    assert cost == Decimal(0)


def test_reqlog_ac29_api_mode_costs_tokens_times_price() -> None:
    assert request_cost([OCTOBER_ENTRY], "api", MODEL, DAY, 1_200, 300) == Decimal("0.0081")


def test_reqlog_ac29_entry_valid_from_the_same_day_applies() -> None:
    entry = price("3", "15", DAY)
    assert request_cost([entry], "api", MODEL, DAY, 1_200, 300) == Decimal("0.0081")


def test_reqlog_ac29_cost_has_six_decimal_places() -> None:
    cost = request_cost([OCTOBER_ENTRY], "api", MODEL, DAY, 1_200, 300)
    assert cost is not None
    assert cost.as_tuple().exponent == -6


def test_reqlog_ac29_rounds_half_up_at_the_sixth_place() -> None:
    entry = price("0.5", "0", date(2026, 10, 1))
    assert request_cost([entry], "api", MODEL, DAY, 1, 0) == Decimal("0.000001")


def test_reqlog_ac29_rounds_down_below_half_at_the_sixth_place() -> None:
    entry = price("0.4", "0", date(2026, 10, 1))
    assert request_cost([entry], "api", MODEL, DAY, 1, 0) == Decimal("0")


@pytest.mark.parametrize("order", ["oldest_first", "newest_first"])
def test_reqlog_ac30_latest_entry_on_or_before_the_day_wins(order: str) -> None:
    entries = [OCTOBER_ENTRY, price("1", "5", date(2026, 10, 20))]
    if order == "newest_first":
        entries.reverse()
    assert request_cost(entries, "api", MODEL, DAY, 1_000_000, 0) == Decimal(1)


def test_reqlog_ac30_entry_after_the_day_is_ignored() -> None:
    entries = [OCTOBER_ENTRY, price("1", "5", date(2026, 11, 1))]
    assert request_cost(entries, "api", MODEL, DAY, 1_000_000, 0) == Decimal(3)


def test_reqlog_ac31_entry_only_after_the_day_gives_no_cost() -> None:
    entry = price("3", "15", date(2026, 11, 1))
    assert request_cost([entry], "api", MODEL, DAY, 1_200, 300) is None


def test_reqlog_ac32_model_without_entry_gives_no_cost() -> None:
    assert request_cost([OCTOBER_ENTRY], "api", "other-model", DAY, 1_200, 300) is None


def test_reqlog_ac32_model_name_must_match_exactly() -> None:
    assert request_cost([OCTOBER_ENTRY], "api", f"{MODEL}-latest", DAY, 1_200, 300) is None
    assert request_cost([OCTOBER_ENTRY], "api", MODEL.upper(), DAY, 1_200, 300) is None


def test_reqlog_ac32_empty_price_table_gives_no_cost() -> None:
    assert request_cost([], "api", MODEL, DAY, 1_200, 300) is None


def test_reqlog_ac33_empty_prompt_tokens_give_no_cost() -> None:
    assert request_cost([OCTOBER_ENTRY], "api", MODEL, DAY, None, 300) is None


def test_reqlog_ac33_empty_completion_tokens_give_no_cost() -> None:
    assert request_cost([OCTOBER_ENTRY], "api", MODEL, DAY, 1_200, None) is None


def test_reqlog_ac33_zero_tokens_cost_zero() -> None:
    assert request_cost([OCTOBER_ENTRY], "api", MODEL, DAY, 0, 0) == Decimal(0)


def test_reqlog_ac34_shipped_table_has_both_api_models() -> None:
    assert {entry.model for entry in PRICES} >= {"claude-haiku-5-5", "claude-sonnet-5-5"}


def test_reqlog_ac34_shipped_entries_have_every_field() -> None:
    for entry in PRICES:
        assert entry.model
        assert isinstance(entry.prompt_usd_per_mtok, Decimal)
        assert isinstance(entry.completion_usd_per_mtok, Decimal)
        assert entry.prompt_usd_per_mtok >= 0
        assert entry.completion_usd_per_mtok >= 0
        assert isinstance(entry.valid_from, date)
        assert entry.source_url.startswith("https://")
        assert isinstance(entry.read_on, date)


def test_reqlog_ac34_shipped_entries_are_unique_per_model_and_date() -> None:
    keys = [(entry.model, entry.valid_from) for entry in PRICES]
    assert len(keys) == len(set(keys))


def test_reqlog_ac34_shipped_prices_match_the_decision() -> None:
    by_model = {entry.model: entry for entry in PRICES}
    sonnet = by_model["claude-sonnet-5-5"]
    haiku = by_model["claude-haiku-5-5"]
    assert (sonnet.prompt_usd_per_mtok, sonnet.completion_usd_per_mtok) == (
        Decimal("2"),
        Decimal("10"),
    )
    assert (haiku.prompt_usd_per_mtok, haiku.completion_usd_per_mtok) == (
        Decimal("0.10"),
        Decimal("0.50"),
    )
    for entry in PRICES:
        assert entry.source_url == "https://platform.claude.com/docs/en/about-claude/pricing"
        assert entry.read_on == date(2026, 10, 30)
        assert entry.valid_from == date(2026, 10, 30)


def test_reqlog_ac34_shipped_sonnet_price_applies_on_the_read_day() -> None:
    cost = request_cost(PRICES, "api", "claude-sonnet-5-5", DAY, 1_200, 300)
    assert cost == Decimal("0.0054")
