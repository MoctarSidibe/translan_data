from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from app.database import get_db
from app.models.user import User
from app.models.knowledge import KnowledgeItem, KnowledgeLink
from app.core.security import get_current_user
from app.services.embeddings import embed_text
from app.services.ai import generate_knowledge_summary, suggest_tags, suggest_links
from pydantic import BaseModel
from typing import Optional
import json as _json

router = APIRouter(prefix="/api/knowledge", tags=["knowledge"])


class KnowledgeCreate(BaseModel):
    title: str
    content: str
    category: str = "General"
    tags: list[str] = []
    source_type: str = "manual"
    source_file: Optional[str] = None
    price: float = 0.0


class KnowledgeUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    category: Optional[str] = None
    tags: Optional[list[str]] = None
    is_public: Optional[bool] = None
    price: Optional[float] = None


def _serialize(item: KnowledgeItem) -> dict:
    return {
        "id": item.id,
        "title": item.title,
        "content": item.content,
        "summary": item.summary,
        "category": item.category,
        "tags": item.tags,
        "source_type": item.source_type,
        "source_file": item.source_file,
        "is_public": item.is_public,
        "price": item.price,
        "rating": item.rating,
        "rating_count": item.rating_count,
        "download_count": item.download_count,
        "created_at": item.created_at.isoformat(),
        "updated_at": item.updated_at.isoformat(),
    }


@router.get("")
async def list_knowledge(
    search: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    tag: Optional[str] = Query(None),
    is_public: Optional[bool] = Query(None),
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = select(KnowledgeItem).where(KnowledgeItem.owner_id == user.id)

    if search:
        stmt = stmt.where(
            or_(KnowledgeItem.title.ilike(f"%{search}%"), KnowledgeItem.content.ilike(f"%{search}%"))
        )
    if category:
        stmt = stmt.where(KnowledgeItem.category == category)
    if is_public is not None:
        stmt = stmt.where(KnowledgeItem.is_public == is_public)

    stmt = stmt.order_by(KnowledgeItem.updated_at.desc()).offset(skip).limit(limit)
    result = await db.execute(stmt)
    items = result.scalars().all()
    return [_serialize(i) for i in items]


@router.post("", status_code=201)
async def create_knowledge(
    data: KnowledgeCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # AI-generate summary and tags if not provided
    summary = await generate_knowledge_summary(data.title, data.content)
    tags = data.tags or await suggest_tags(data.title, data.content)

    # Embed for semantic search (stored as JSON text)
    embedding_vec = await embed_text(f"{data.title}\n{data.content[:1000]}")

    item = KnowledgeItem(
        owner_id=user.id,
        title=data.title,
        content=data.content,
        summary=summary,
        category=data.category,
        tags=tags,
        source_type=data.source_type,
        source_file=data.source_file,
        price=data.price,
        embedding=_json.dumps(embedding_vec),
    )
    db.add(item)
    await db.flush()
    return _serialize(item)


@router.get("/{item_id}")
async def get_knowledge(
    item_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(KnowledgeItem).where(KnowledgeItem.id == item_id, KnowledgeItem.owner_id == user.id)
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Knowledge item not found")
    return _serialize(item)


@router.put("/{item_id}")
async def update_knowledge(
    item_id: int,
    data: KnowledgeUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(KnowledgeItem).where(KnowledgeItem.id == item_id, KnowledgeItem.owner_id == user.id)
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Knowledge item not found")

    if data.title is not None:
        item.title = data.title
    if data.content is not None:
        item.content = data.content
        item.summary = await generate_knowledge_summary(item.title, data.content)
        item.embedding = _json.dumps(await embed_text(f"{item.title}\n{data.content[:1000]}"))
    if data.category is not None:
        item.category = data.category
    if data.tags is not None:
        item.tags = data.tags
    if data.is_public is not None:
        item.is_public = data.is_public
    if data.price is not None:
        item.price = data.price

    db.add(item)
    return _serialize(item)


@router.delete("/{item_id}", status_code=204)
async def delete_knowledge(
    item_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(KnowledgeItem).where(KnowledgeItem.id == item_id, KnowledgeItem.owner_id == user.id)
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Knowledge item not found")
    await db.delete(item)


# ── Knowledge Graph Links ─────────────────────────────────────────────────────

@router.post("/{item_id}/links")
async def add_link(
    item_id: int,
    target_id: int,
    label: str = "",
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    link = KnowledgeLink(source_id=item_id, target_id=target_id, label=label)
    db.add(link)
    await db.flush()
    return {"id": link.id, "source_id": item_id, "target_id": target_id, "label": label}


@router.get("/{item_id}/links")
async def get_links(
    item_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(KnowledgeLink).where(KnowledgeLink.source_id == item_id)
    )
    links = result.scalars().all()
    return [{"id": l.id, "source_id": l.source_id, "target_id": l.target_id, "label": l.label} for l in links]


@router.post("/{item_id}/suggest-links")
async def get_suggested_links(
    item_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """AI-suggested links for a knowledge item."""
    result = await db.execute(
        select(KnowledgeItem).where(KnowledgeItem.id == item_id, KnowledgeItem.owner_id == user.id)
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Not found")

    all_result = await db.execute(
        select(KnowledgeItem).where(KnowledgeItem.owner_id == user.id, KnowledgeItem.id != item_id).limit(50)
    )
    candidates = [{"id": c.id, "title": c.title, "summary": c.summary} for c in all_result.scalars().all()]
    suggested_ids = await suggest_links(item.title, item.content, candidates)
    suggested = [c for c in candidates if c["id"] in suggested_ids]
    return {"suggested": suggested}


@router.post("/{item_id}/publish")
async def publish_knowledge(
    item_id: int,
    price: float = 0.0,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(KnowledgeItem).where(KnowledgeItem.id == item_id, KnowledgeItem.owner_id == user.id)
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Not found")
    item.is_public = True
    item.price = price
    db.add(item)
    return {"message": "Published", "item_id": item_id, "price": price}
