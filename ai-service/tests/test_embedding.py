import math
from pathlib import Path
from typing import Any

import pytest

from ai_service import embedding
from ai_service.embedding import MODEL_CACHE_DIR, EmbeddingModelError, FastEmbedEmbedder
from ai_service.settings import WorkerSettings
from tests.hashing_embedder import HashingEmbedder

SERVICE_ROOT = Path(__file__).resolve().parents[1]


def test_index_ac77_model_that_fails_to_load_raises_naming_the_model(
    monkeypatch: pytest.MonkeyPatch,
):
    def refuse(**kwargs: Any) -> None:
        raise OSError("download failed")

    monkeypatch.setattr(embedding, "TextEmbedding", refuse)
    with pytest.raises(EmbeddingModelError) as error:
        FastEmbedEmbedder("jinaai/jina-embeddings-v2-base-de")
    assert "jinaai/jina-embeddings-v2-base-de" in str(error.value)
    assert isinstance(error.value.__cause__, OSError)


def test_index_ac77_unknown_model_name_raises_naming_the_model(tmp_path: Path):
    with pytest.raises(EmbeddingModelError) as error:
        FastEmbedEmbedder("no-such/model-name", cache_dir=tmp_path)
    assert "no-such/model-name" in str(error.value)


def test_fastembed_loads_from_the_service_cache_by_default(monkeypatch: pytest.MonkeyPatch):
    received: dict[str, Any] = {}

    def record(**kwargs: Any) -> object:
        received.update(kwargs)
        return object()

    monkeypatch.setattr(embedding, "TextEmbedding", record)
    embedder = FastEmbedEmbedder("some/model")
    assert embedder.model_name == "some/model"
    assert received == {"model_name": "some/model", "cache_dir": str(MODEL_CACHE_DIR)}
    assert MODEL_CACHE_DIR == SERVICE_ROOT / ".cache" / "fastembed"


def test_hashing_embedder_is_deterministic_and_normalised():
    first = HashingEmbedder().embed(["Urlaub beantragen", "Urlaub"])
    second = HashingEmbedder().embed(["urlaub BEANTRAGEN!", "Urlaub"])
    assert first == second
    assert all(len(vector) == 256 for vector in first)
    assert all(math.isclose(math.hypot(*vector), 1.0) for vector in first)


@pytest.mark.integration
@pytest.mark.model
def test_index_ac12_real_model_gives_the_same_embedding_for_the_same_text():
    embedder = FastEmbedEmbedder(WorkerSettings.model_fields["ai_embedding_model"].default)
    texts = ["Urlaub wird im Portal beantragt.", "Reisekosten bis 30 Tage einreichen."]
    first, second = embedder.embed(texts), embedder.embed(list(reversed(texts)))[::-1]
    assert all(type(component) is float for component in first[0])
    assert len(first[0]) == 768
    for a, b in zip(first, second, strict=True):
        assert max(abs(x - y) for x, y in zip(a, b, strict=True)) <= 1e-5
