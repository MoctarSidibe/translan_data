"""
AI service — currently wired to Groq (free, Llama 3.3 70B).
To upgrade to Claude, set USE_CLAUDE=true and provide ANTHROPIC_API_KEY.
"""
from groq import AsyncGroq
from app.core.config import settings
from typing import AsyncIterator

_groq_client: AsyncGroq | None = None


def get_groq_client() -> AsyncGroq:
    global _groq_client
    if _groq_client is None:
        _groq_client = AsyncGroq(api_key=settings.GROQ_API_KEY)
    return _groq_client


async def chat_completion(
    messages: list[dict],
    stream: bool = False,
    temperature: float = 0.7,
    max_tokens: int = 2048,
) -> str | AsyncIterator:
    """Send messages to the AI and return the response text."""
    client = get_groq_client()

    response = await client.chat.completions.create(
        model=settings.GROQ_MODEL,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        stream=stream,
    )

    if stream:
        return response  # caller handles streaming

    return response.choices[0].message.content


async def generate_knowledge_summary(title: str, content: str) -> str:
    """Generate a concise AI summary for a knowledge item."""
    prompt = f"""Summarize the following knowledge entry in 2-3 sentences. Be concise and factual.

Title: {title}

Content:
{content[:3000]}

Summary:"""
    return await chat_completion([{"role": "user", "content": prompt}], temperature=0.3, max_tokens=200)


async def suggest_tags(title: str, content: str) -> list[str]:
    """AI-suggested tags for a knowledge item."""
    prompt = f"""Given this knowledge entry, suggest 3-5 relevant tags (single words or short phrases).
Return ONLY a JSON array of strings, nothing else.

Title: {title}
Content: {content[:1000]}

Tags:"""
    import json
    result = await chat_completion([{"role": "user", "content": prompt}], temperature=0.3, max_tokens=100)
    try:
        tags = json.loads(result)
        return [str(t) for t in tags[:5]]
    except Exception:
        return []


async def suggest_links(item_title: str, item_content: str, candidates: list[dict]) -> list[int]:
    """AI-suggested knowledge links — returns IDs of related items."""
    if not candidates:
        return []
    candidate_text = "\n".join(
        f"ID {c['id']}: {c['title']} — {c.get('summary', '')[:100]}" for c in candidates[:20]
    )
    prompt = f"""Given the source knowledge item below, which of the candidate items are most related?
Return ONLY a JSON array of IDs (max 5), nothing else.

Source: {item_title}
{item_content[:500]}

Candidates:
{candidate_text}

Related IDs:"""
    import json
    result = await chat_completion([{"role": "user", "content": prompt}], temperature=0.2, max_tokens=50)
    try:
        ids = json.loads(result)
        return [int(i) for i in ids if isinstance(i, (int, str))][:5]
    except Exception:
        return []
