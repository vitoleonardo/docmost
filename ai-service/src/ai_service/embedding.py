from collections.abc import Sequence
from pathlib import Path
from typing import Protocol

from fastembed import TextEmbedding

MODEL_CACHE_DIR = Path(__file__).resolve().parents[2] / ".cache" / "fastembed"


class EmbeddingModelError(RuntimeError):
    def __init__(self, model_name: str) -> None:
        super().__init__(f"Embedding model could not be loaded: {model_name}")
        self.model_name = model_name


class Embedder(Protocol):
    model_name: str

    def embed(self, texts: Sequence[str]) -> list[list[float]]: ...


class FastEmbedEmbedder:
    def __init__(self, model_name: str, cache_dir: Path | None = None) -> None:
        self.model_name = model_name
        try:
            self._model = TextEmbedding(
                model_name=model_name, cache_dir=str(cache_dir or MODEL_CACHE_DIR)
            )
        except Exception as error:
            raise EmbeddingModelError(model_name) from error

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        return [[float(component) for component in vector] for vector in self._model.embed(texts)]
