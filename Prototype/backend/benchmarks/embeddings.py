"""OpenAI-compatible and deterministic fake embedders for synthetic text only."""

import hashlib
import math
import os
import re
import time
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import urlsplit

import httpx

from app import database as db


@dataclass(frozen=True)
class EmbeddingBatch:
    vectors: list[list[float]]
    input_tokens: int | None
    latency_seconds: float


class Embedder(Protocol):
    model: str

    def embed(self, texts: list[str]) -> EmbeddingBatch: ...


class EmbeddingConfigurationError(ValueError):
    """The remote embedding configuration is incomplete or invalid."""


def _normalize_text(value: str) -> str:
    return " ".join(value.strip().casefold().split())


def _normalize_labels(values: list[str]) -> str:
    return ", ".join(sorted((_normalize_text(value) for value in values), key=str.casefold))


def profile_text(profile: db.Profile) -> str:
    """Compose the benchmark's documented, ID/status-free profile text."""
    return "\n".join((
        f"Profile skills: {_normalize_labels(profile.skills)}",
        f"Profile interests: {_normalize_labels(profile.interests)}",
        f"Profile availability: {_normalize_labels(profile.availability)}",
    ))


def opportunity_text(opportunity: db.Opportunity) -> str:
    """Compose the benchmark's documented, ID/status-free opportunity text."""
    return "\n".join((
        f"Opportunity title: {_normalize_text(opportunity.title)}",
        f"Opportunity description: {_normalize_text(opportunity.description)}",
        f"Opportunity category: {_normalize_text(opportunity.category)}",
        f"Opportunity required skills: {_normalize_labels(opportunity.required_skills)}",
        f"Opportunity interests: {_normalize_labels(opportunity.interests)}",
        f"Opportunity availability: {_normalize_labels(opportunity.availability)}",
    ))


class OpenAICompatibleEmbedder:
    """Call a compatible ``POST /embeddings`` endpoint without logging secrets."""

    def __init__(self, base_url: str, model: str, api_key: str, timeout_seconds: float):
        parsed = urlsplit(base_url)
        if (
            parsed.scheme not in {"https", "http"}
            or not parsed.netloc
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
        ):
            raise EmbeddingConfigurationError("GONURSE_EMBEDDING_BASE_URL must be an HTTP(S) base URL.")
        host = (parsed.hostname or "").casefold()
        if parsed.scheme != "https" and host not in {"localhost", "127.0.0.1", "::1"}:
            raise EmbeddingConfigurationError("Embedding endpoints must use HTTPS except on loopback.")
        if not model.strip() or not api_key.strip():
            raise EmbeddingConfigurationError("Embedding model and API key are required.")
        if not math.isfinite(timeout_seconds) or not 0 < timeout_seconds <= 300:
            raise EmbeddingConfigurationError("Embedding timeout must be greater than 0 and at most 300 seconds.")
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.api_key = api_key
        self.timeout_seconds = timeout_seconds

    @classmethod
    def from_environment(cls) -> "OpenAICompatibleEmbedder":
        model = os.environ.get("GONURSE_EMBEDDING_MODEL", "")
        api_key = os.environ.get("GONURSE_EMBEDDING_API_KEY", "")
        try:
            timeout = float(os.environ.get("GONURSE_EMBEDDING_TIMEOUT_SECONDS", "30"))
        except ValueError as error:
            raise EmbeddingConfigurationError("Embedding timeout must be a positive number.") from error
        return cls(
            os.environ.get("GONURSE_EMBEDDING_BASE_URL", "https://api.openai.com/v1"),
            model,
            api_key,
            timeout,
        )

    def embed(self, texts: list[str]) -> EmbeddingBatch:
        if not texts:
            return EmbeddingBatch([], 0, 0.0)
        start = time.perf_counter()
        with httpx.Client(
            timeout=self.timeout_seconds,
            follow_redirects=False,
            trust_env=False,
        ) as client:
            response = client.post(
                f"{self.base_url}/embeddings",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={"model": self.model, "input": texts},
            )
        response.raise_for_status()
        payload = response.json()
        rows = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(rows, list) or len(rows) != len(texts):
            raise ValueError("Embedding provider returned an invalid number of vectors.")
        indexed: list[list[float] | None] = [None] * len(texts)
        for row in rows:
            if not isinstance(row, dict) or type(row.get("index")) is not int:
                raise ValueError("Embedding provider returned an invalid vector record.")
            index = row["index"]
            vector = row.get("embedding")
            if not 0 <= index < len(texts) or indexed[index] is not None:
                raise ValueError("Embedding provider returned duplicate or invalid vector indices.")
            if (
                not isinstance(vector, list)
                or not vector
                or any(type(value) not in {int, float} or not math.isfinite(value) for value in vector)
            ):
                raise ValueError("Embedding provider returned an invalid vector.")
            indexed[index] = [float(value) for value in vector]
        vectors = [vector for vector in indexed if vector is not None]
        if len(vectors) != len(texts) or len({len(vector) for vector in vectors}) != 1:
            raise ValueError("Embedding provider returned inconsistent vector dimensions.")
        usage = payload.get("usage")
        token_count = usage.get("prompt_tokens") if isinstance(usage, dict) else None
        if token_count is not None and (type(token_count) is not int or token_count < 0):
            raise ValueError("Embedding provider returned invalid token usage.")
        return EmbeddingBatch(vectors, token_count, time.perf_counter() - start)


class FakeEmbedder:
    """Deterministic bag-of-terms embedder with the benchmark's fixed synonym pair."""

    def __init__(self, dimensions: int = 64):
        if dimensions < 8:
            raise ValueError("Fake embedding dimension must be at least 8.")
        self.model = f"fake-hash-v1-{dimensions}"
        self.dimensions = dimensions

    def embed(self, texts: list[str]) -> EmbeddingBatch:
        start = time.perf_counter()
        vectors = []
        aliases = {"icu": "criticalcare"}
        for text in texts:
            vector = [0.0] * self.dimensions
            tokens = re.findall(r"[a-z0-9]+", _normalize_text(text))
            normalized = []
            index = 0
            while index < len(tokens):
                if tokens[index:index + 2] == ["critical", "care"]:
                    normalized.append("criticalcare")
                    index += 2
                else:
                    normalized.append(aliases.get(tokens[index], tokens[index]))
                    index += 1
            for token in normalized:
                digest = hashlib.sha256(token.encode("utf-8")).digest()
                position = int.from_bytes(digest[:4], "big") % self.dimensions
                vector[position] += 1.0 if digest[4] & 1 else -1.0
            vectors.append(vector)
        return EmbeddingBatch(vectors, None, time.perf_counter() - start)
