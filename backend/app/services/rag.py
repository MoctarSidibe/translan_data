"""
RAG pipeline — Retrieval-Augmented Generation.
1. Embed the user query
2. Load all embeddings for user's knowledge (stored as JSON in Postgres)
3. Compute cosine similarity in Python/numpy
4. Build context from top-k results
5. Call Groq AI with context → return answer + source citations

Note: This pure-Python approach works without pgvector.
Upgrade path: Once pgvector is installed on the system, swap step 2-3
for a native <=> vector distance query (much faster for large datasets).
"""
import json
import numpy as np
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.knowledge import KnowledgeItem, QueryHistory
from app.services.embeddings import embed_text
from app.services.ai import chat_completion


SYSTEM_PROMPT = """You are Translan Data, a personal AI knowledge assistant.
Answer the user's question using ONLY the provided context from their personal knowledge base.
If the context doesn't contain enough information, say so clearly.
Always be concise, factual, and cite your sources by mentioning the knowledge item titles.
"""


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    va = np.array(a, dtype=np.float32)
    vb = np.array(b, dtype=np.float32)
    denom = np.linalg.norm(va) * np.linalg.norm(vb)
    if denom == 0:
        return 0.0
    return float(np.dot(va, vb) / denom)


async def rag_query(
    user_id: int,
    query: str,
    db: AsyncSession,
    top_k: int = 5,
) -> dict:
    """
    Run a full RAG query.
    Returns: {answer, sources: [{id, title, excerpt, similarity}], query_id}
    """
    # 1. Embed the query
    query_embedding = await embed_text(query)

    # 2. Load all knowledge items that have embeddings
    stmt = select(KnowledgeItem).where(
        KnowledgeItem.owner_id == user_id,
        KnowledgeItem.embedding.isnot(None),
    )
    result = await db.execute(stmt)
    items = result.scalars().all()

    # 3. Compute cosine similarity in Python
    scored = []
    for item in items:
        try:
            item_embedding = json.loads(item.embedding)
            sim = _cosine_similarity(query_embedding, item_embedding)
            scored.append((sim, item))
        except Exception:
            continue

    # Sort by similarity, take top-k
    scored.sort(key=lambda x: x[0], reverse=True)
    top = scored[:top_k]

    # 4. Build context
    sources = []
    context_parts = []
    for sim, item in top:
        excerpt = (item.content or item.summary or "")[:500]
        sources.append({
            "id": item.id,
            "title": item.title,
            "excerpt": excerpt,
            "similarity": round(sim, 4),
        })
        context_parts.append(f"### {item.title}\n{excerpt}")

    context = (
        "\n\n".join(context_parts)
        if context_parts
        else "No relevant knowledge found in your personal database."
    )

    # 5. Build messages and call AI
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": f"Context from knowledge base:\n{context}\n\n---\n\nQuestion: {query}",
        },
    ]
    answer = await chat_completion(messages, stream=False)

    # 6. Save to query history
    history = QueryHistory(
        user_id=user_id,
        query_text=query,
        answer_text=answer,
        sources=sources,
    )
    db.add(history)
    await db.flush()

    return {
        "query_id": history.id,
        "answer": answer,
        "sources": sources,
    }


async def get_recent_queries(user_id: int, db: AsyncSession, limit: int = 20) -> list:
    stmt = (
        select(QueryHistory)
        .where(QueryHistory.user_id == user_id)
        .order_by(QueryHistory.created_at.desc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    return result.scalars().all()
