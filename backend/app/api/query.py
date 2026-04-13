from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.user import User
from app.core.security import get_current_user
from app.services.rag import rag_query, get_recent_queries
from pydantic import BaseModel

router = APIRouter(prefix="/api/query", tags=["query"])


class QueryRequest(BaseModel):
    text: str
    top_k: int = 5


class QueryResponse(BaseModel):
    query_id: int
    answer: str
    sources: list[dict]


@router.post("", response_model=QueryResponse)
async def run_query(
    req: QueryRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Query text cannot be empty")

    result = await rag_query(
        user_id=user.id,
        query=req.text,
        db=db,
        top_k=req.top_k,
    )
    return result


@router.get("/history")
async def query_history(
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return recent queries for the roll-up panel."""
    history = await get_recent_queries(user.id, db, limit=limit)
    return [
        {
            "id": h.id,
            "query_text": h.query_text,
            "answer_text": h.answer_text,
            "sources": h.sources,
            "created_at": h.created_at.isoformat(),
        }
        for h in history
    ]


@router.delete("/history/{query_id}")
async def delete_query(
    query_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from sqlalchemy import select
    from app.models.knowledge import QueryHistory
    result = await db.execute(
        select(QueryHistory).where(QueryHistory.id == query_id, QueryHistory.user_id == user.id)
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Query not found")
    await db.delete(item)
    return {"message": "Deleted"}
