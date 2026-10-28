import math
from pathlib import Path
from typing import Any

import pytest

from ai_service import embedding
from ai_service.embedding import MODEL_CACHE_DIR, EmbeddingModelError, FastEmbedEmbedder
from ai_service.index_store import IndexStore
from ai_service.indexer import Indexer
from ai_service.settings import WorkerSettings
from tests.fake_bridge import seed_shaped_bridge
from tests.hashing_embedder import HashingEmbedder
from tests.index_db import max_component_difference, stored_and_fresh_embeddings

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
def test_index_ac12_real_model_reembeds_indexed_sections_to_their_stored_embedding(
    store: IndexStore,
):
    embedder = FastEmbedEmbedder(WorkerSettings.model_fields["ai_embedding_model"].default)
    bridge = seed_shaped_bridge()
    indexer = Indexer(bridge.client(), store, embedder)
    for listed in bridge.listed_ids():
        indexer.index_page(listed)

    pairs = stored_and_fresh_embeddings(store, embedder)

    assert any(section.attachment_id is None and section.heading_path for section, _ in pairs)
    assert any(section.attachment_id is not None for section, _ in pairs)
    assert all(type(component) is float for component in pairs[0][1])
    assert len(pairs[0][1]) == 768
    for section, fresh in pairs:
        assert max_component_difference(section.embedding, fresh) <= 1e-5
