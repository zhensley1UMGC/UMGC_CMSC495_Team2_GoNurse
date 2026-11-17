"""Local SQLite embedding cache keyed by model and canonical text hash."""

import hashlib
import json
import math
import sqlite3
from pathlib import Path


class VectorCache:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(path)
        self.connection.execute("""
            CREATE TABLE IF NOT EXISTS embeddings (
                model TEXT NOT NULL,
                text_sha256 TEXT NOT NULL,
                dimension INTEGER NOT NULL,
                vector_json TEXT NOT NULL,
                PRIMARY KEY (model, text_sha256)
            )
        """)
        self.connection.commit()
        self.hits = 0
        self.misses = 0

    @staticmethod
    def text_hash(text: str) -> str:
        return hashlib.sha256(text.encode("utf-8")).hexdigest()

    def get(self, model: str, text: str) -> list[float] | None:
        row = self.connection.execute(
            "SELECT dimension, vector_json FROM embeddings WHERE model = ? AND text_sha256 = ?",
            (model, self.text_hash(text)),
        ).fetchone()
        if row is None:
            self.misses += 1
            return None
        dimension, encoded = row
        vector = json.loads(encoded)
        if (
            not isinstance(vector, list)
            or len(vector) != dimension
            or not vector
            or any(type(value) not in {int, float} or not math.isfinite(value) for value in vector)
        ):
            raise ValueError("Cached embedding is corrupt or has an invalid dimension.")
        self.hits += 1
        return [float(value) for value in vector]

    def put(self, model: str, text: str, vector: list[float]) -> None:
        if not vector or any(not math.isfinite(value) for value in vector) or not any(value != 0 for value in vector):
            raise ValueError("Cannot cache an empty, zero, or non-finite vector.")
        dimension = len(vector)
        existing = self.connection.execute(
            "SELECT dimension FROM embeddings WHERE model = ? LIMIT 1", (model,),
        ).fetchone()
        if existing is not None and existing[0] != dimension:
            raise ValueError(f"Cached vectors for model {model!r} use a different dimension.")
        self.connection.execute(
            """
            INSERT INTO embeddings (model, text_sha256, dimension, vector_json)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (model, text_sha256) DO UPDATE SET
                dimension = excluded.dimension, vector_json = excluded.vector_json
            """,
            (model, self.text_hash(text), dimension, json.dumps(vector, separators=(",", ":"))),
        )
        self.connection.commit()

    def close(self) -> None:
        self.connection.close()


def embed_cached(embedder, texts: list[str], cache: VectorCache) -> tuple[list[list[float]], int | None, float]:
    """Reuse cached vectors and embed only cache misses in a single batch."""
    vectors: list[list[float] | None] = [None] * len(texts)
    missing_by_hash: dict[str, int] = {}
    for index, text in enumerate(texts):
        cached = cache.get(embedder.model, text)
        if cached is not None:
            vectors[index] = cached
        else:
            missing_by_hash.setdefault(cache.text_hash(text), index)

    missing_texts = [texts[index] for index in missing_by_hash.values()]
    token_count: int | None = 0
    latency = 0.0
    if missing_texts:
        batch = embedder.embed(missing_texts)
        if len(batch.vectors) != len(missing_texts):
            raise ValueError("Embedder returned the wrong number of vectors.")
        dimensions = {len(vector) for vector in batch.vectors}
        if len(dimensions) != 1 or not next(iter(dimensions), 0):
            raise ValueError("Embedder returned inconsistent or empty vector dimensions.")
        for (text_hash, original_index), vector in zip(missing_by_hash.items(), batch.vectors, strict=True):
            text = texts[original_index]
            cache.put(embedder.model, text, vector)
            for index, candidate_text in enumerate(texts):
                if cache.text_hash(candidate_text) == text_hash:
                    vectors[index] = vector
        token_count = batch.input_tokens
        latency = batch.latency_seconds
    if any(vector is None for vector in vectors):
        raise ValueError("Embedding cache failed to populate every input vector.")
    return [vector for vector in vectors if vector is not None], token_count, latency
