from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update
from app.database import get_db
from app.models.user import User
from app.models.knowledge import KnowledgeItem, MarketplacePurchase
from app.core.security import get_current_user
from typing import Optional
from pydantic import BaseModel

router = APIRouter(prefix="/api/marketplace", tags=["marketplace"])


@router.get("")
async def browse_marketplace(
    search: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    sort: str = Query("rating", pattern="^(rating|newest|downloads)$"),
    free_only: bool = False,
    skip: int = 0,
    limit: int = 30,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = select(KnowledgeItem, User.username).join(User).where(KnowledgeItem.is_public == True)

    if search:
        stmt = stmt.where(KnowledgeItem.title.ilike(f"%{search}%"))
    if category:
        stmt = stmt.where(KnowledgeItem.category == category)
    if free_only:
        stmt = stmt.where(KnowledgeItem.price == 0)

    if sort == "rating":
        stmt = stmt.order_by(KnowledgeItem.rating.desc())
    elif sort == "newest":
        stmt = stmt.order_by(KnowledgeItem.created_at.desc())
    elif sort == "downloads":
        stmt = stmt.order_by(KnowledgeItem.download_count.desc())

    stmt = stmt.offset(skip).limit(limit)
    result = await db.execute(stmt)
    rows = result.all()

    return [
        {
            "id": item.id,
            "title": item.title,
            "summary": item.summary,
            "category": item.category,
            "tags": item.tags,
            "price": item.price,
            "rating": item.rating,
            "rating_count": item.rating_count,
            "download_count": item.download_count,
            "author": username,
            "created_at": item.created_at.isoformat(),
        }
        for item, username in rows
    ]


@router.post("/{item_id}/rate")
async def rate_knowledge(
    item_id: int,
    stars: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not 1 <= stars <= 5:
        raise HTTPException(status_code=400, detail="Stars must be between 1 and 5")

    result = await db.execute(
        select(KnowledgeItem).where(KnowledgeItem.id == item_id, KnowledgeItem.is_public == True)
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found in marketplace")

    # Incremental average
    new_count = item.rating_count + 1
    new_rating = round(((item.rating * item.rating_count) + stars) / new_count, 2)
    item.rating = new_rating
    item.rating_count = new_count
    db.add(item)
    return {"rating": new_rating, "rating_count": new_count}


@router.post("/{item_id}/purchase")
async def purchase_knowledge(
    item_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Record a purchase / download of a public knowledge item."""
    result = await db.execute(
        select(KnowledgeItem).where(KnowledgeItem.id == item_id, KnowledgeItem.is_public == True)
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Not found")

    purchase = MarketplacePurchase(
        buyer_id=user.id,
        knowledge_id=item_id,
        amount_paid=item.price,
    )
    item.download_count += 1
    db.add(purchase)
    db.add(item)
    await db.flush()

    return {
        "message": "Access granted",
        "knowledge_id": item_id,
        "title": item.title,
        "content": item.content,
    }
