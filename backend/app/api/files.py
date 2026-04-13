import os
import uuid
import json as _json
import aiofiles
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.user import User
from app.core.security import get_current_user
from app.core.config import settings
from app.services.file_parser import parse_file, parse_url, chunk_text
from app.services.embeddings import embed_text
from app.services.ai import generate_knowledge_summary, suggest_tags
from app.models.knowledge import KnowledgeItem
from pydantic import BaseModel

router = APIRouter(prefix="/api/files", tags=["files"])

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".doc", ".txt", ".md", ".csv"}
MAX_BYTES = settings.MAX_FILE_SIZE_MB * 1024 * 1024


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Upload a local file, parse it, embed it, and save as a knowledge item."""
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")

    # Save to disk
    file_id = uuid.uuid4().hex
    save_path = os.path.join(settings.UPLOAD_DIR, f"{file_id}{ext}")
    content_bytes = await file.read()
    if len(content_bytes) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="File too large")

    async with aiofiles.open(save_path, "wb") as f:
        await f.write(content_bytes)

    # Parse
    title, content = await parse_file(save_path)
    if not content.strip():
        raise HTTPException(status_code=422, detail="Could not extract text from file")

    # AI enrichment
    summary = await generate_knowledge_summary(title, content)
    tags = await suggest_tags(title, content)
    embedding_vec = await embed_text(f"{title}\n{content[:1000]}")

    # Save as knowledge item
    item = KnowledgeItem(
        owner_id=user.id,
        title=title,
        content=content,
        summary=summary,
        tags=tags,
        source_type="file",
        source_file=file.filename,
        embedding=_json.dumps(embedding_vec),
    )
    db.add(item)
    await db.flush()

    return {
        "knowledge_id": item.id,
        "title": title,
        "summary": summary,
        "tags": tags,
        "char_count": len(content),
    }


class ScrapeRequest(BaseModel):
    url: str


@router.post("/scrape")
async def scrape_url(
    req: ScrapeRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Scrape a web URL, extract content, embed, and save as knowledge item."""
    try:
        title, content = await parse_url(req.url)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Failed to scrape URL: {str(e)}")

    if not content.strip():
        raise HTTPException(status_code=422, detail="No text content found at URL")

    summary = await generate_knowledge_summary(title, content)
    tags = await suggest_tags(title, content)
    embedding_vec = await embed_text(f"{title}\n{content[:1000]}")

    item = KnowledgeItem(
        owner_id=user.id,
        title=title,
        content=content,
        summary=summary,
        tags=tags,
        source_type="url",
        source_file=req.url,
        embedding=_json.dumps(embedding_vec),
    )
    db.add(item)
    await db.flush()

    return {
        "knowledge_id": item.id,
        "title": title,
        "summary": summary,
        "tags": tags,
        "char_count": len(content),
    }


@router.get("/list-local")
async def list_local_files(
    path: str = ".",
    user: User = Depends(get_current_user),
):
    """List files in a local directory for the file browser."""
    try:
        entries = []
        for name in os.listdir(path):
            full = os.path.join(path, name)
            ext = os.path.splitext(name)[1].lower()
            entries.append({
                "name": name,
                "path": full,
                "is_dir": os.path.isdir(full),
                "size_kb": round(os.path.getsize(full) / 1024, 1) if os.path.isfile(full) else 0,
                "supported": ext in ALLOWED_EXTENSIONS,
                "ext": ext,
            })
        return {"path": path, "entries": sorted(entries, key=lambda x: (not x["is_dir"], x["name"]))}
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Directory not found")
