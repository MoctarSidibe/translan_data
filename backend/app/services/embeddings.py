"""
Local embedding service using sentence-transformers (100% free, runs on CPU).
Model: all-MiniLM-L6-v2 (384 dims, fast and accurate).
"""
from __future__ import annotations
import asyncio
from functools import lru_cache
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sentence_transformers import SentenceTransformer

_model: "SentenceTransformer | None" = None


def _load_model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer("all-MiniLM-L6-v2")
    return _model


async def embed_text(text: str) -> list[float]:  # type: ignore[return]
    """Embed a single text string (runs in thread pool to avoid blocking)."""
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, _embed_sync, text)
    return result


def _embed_sync(text: str) -> list[float]:
    model = _load_model()
    embedding = model.encode(text, normalize_embeddings=True)
    return embedding.tolist()


async def embed_batch(texts: list[str]) -> list[list[float]]:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _embed_batch_sync, texts)


def _embed_batch_sync(texts: list[str]) -> list[list[float]]:
    model = _load_model()
    embeddings = model.encode(texts, normalize_embeddings=True, batch_size=32)
    return [e.tolist() for e in embeddings]
