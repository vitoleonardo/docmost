import hashlib
import math
import re
from collections.abc import Sequence

WORD = re.compile(r"[^\W_]+")


class HashingEmbedder:
    def __init__(self, model_name: str = "test-hashing", dims: int = 256) -> None:
        self.model_name = model_name
        self.dims = dims
        self.calls: list[list[str]] = []

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        self.calls.append(list(texts))
        return [self._embed_one(text) for text in texts]

    def _embed_one(self, text: str) -> list[float]:
        vector = [0.0] * self.dims
        for word in WORD.findall(text.lower()):
            digest = int.from_bytes(hashlib.blake2b(word.encode(), digest_size=8).digest(), "big")
            sign = 1.0 if digest & 1 else -1.0
            vector[(digest >> 1) % self.dims] += sign
        norm = math.sqrt(sum(component * component for component in vector))
        if norm == 0:
            return vector
        return [component / norm for component in vector]
