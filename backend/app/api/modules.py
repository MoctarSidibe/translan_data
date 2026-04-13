from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.user import User
from app.models.module import Module, ModuleRow
from app.core.security import get_current_user
from app.services.ai import chat_completion
from pydantic import BaseModel
from typing import Optional
import json

router = APIRouter(prefix="/api/modules", tags=["modules"])


class ModuleCreate(BaseModel):
    name: str
    description: str = ""
    category: str = "General"
    tags: list[str] = []
    column_definitions: list[dict] = []


class RowCreate(BaseModel):
    data: dict = {}
    image_path: Optional[str] = None
    linked_row_ids: list[int] = []
    linked_knowledge_ids: list[int] = []


@router.get("")
async def list_modules(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Module).where(Module.owner_id == user.id).order_by(Module.updated_at.desc())
    )
    modules = result.scalars().all()
    return [
        {
            "id": m.id, "name": m.name, "description": m.description,
            "category": m.category, "tags": m.tags,
            "column_definitions": m.column_definitions,
            "updated_at": m.updated_at.isoformat(),
        }
        for m in modules
    ]


@router.post("", status_code=201)
async def create_module(
    data: ModuleCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    mod = Module(
        owner_id=user.id,
        name=data.name,
        description=data.description,
        category=data.category,
        tags=data.tags,
        column_definitions=data.column_definitions,
    )
    db.add(mod)
    await db.flush()
    return {"id": mod.id, "name": mod.name}


@router.get("/{module_id}")
async def get_module(
    module_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Module).where(Module.id == module_id, Module.owner_id == user.id)
    )
    mod = result.scalar_one_or_none()
    if not mod:
        raise HTTPException(status_code=404, detail="Module not found")

    rows_result = await db.execute(
        select(ModuleRow).where(ModuleRow.module_id == module_id).order_by(ModuleRow.position)
    )
    rows = rows_result.scalars().all()

    return {
        "id": mod.id,
        "name": mod.name,
        "description": mod.description,
        "category": mod.category,
        "tags": mod.tags,
        "column_definitions": mod.column_definitions,
        "rows": [
            {
                "id": r.id, "position": r.position, "data": r.data,
                "image_path": r.image_path, "linked_row_ids": r.linked_row_ids,
                "linked_knowledge_ids": r.linked_knowledge_ids,
            }
            for r in rows
        ],
    }


@router.delete("/{module_id}", status_code=204)
async def delete_module(
    module_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Module).where(Module.id == module_id, Module.owner_id == user.id)
    )
    mod = result.scalar_one_or_none()
    if not mod:
        raise HTTPException(status_code=404, detail="Module not found")
    await db.delete(mod)


@router.post("/{module_id}/rows", status_code=201)
async def add_row(
    module_id: int,
    data: RowCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # Count existing rows for position
    existing = await db.execute(
        select(ModuleRow).where(ModuleRow.module_id == module_id)
    )
    count = len(existing.scalars().all())

    row = ModuleRow(
        module_id=module_id,
        position=count,
        data=data.data,
        image_path=data.image_path,
        linked_row_ids=data.linked_row_ids,
        linked_knowledge_ids=data.linked_knowledge_ids,
    )
    db.add(row)
    await db.flush()
    return {"id": row.id, "position": row.position}


@router.put("/{module_id}/rows/{row_id}")
async def update_row(
    module_id: int,
    row_id: int,
    data: RowCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(ModuleRow).where(ModuleRow.id == row_id, ModuleRow.module_id == module_id)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Row not found")

    row.data = data.data
    if data.image_path is not None:
        row.image_path = data.image_path
    row.linked_row_ids = data.linked_row_ids
    row.linked_knowledge_ids = data.linked_knowledge_ids
    db.add(row)
    return {"id": row.id}


@router.delete("/{module_id}/rows/{row_id}", status_code=204)
async def delete_row(
    module_id: int,
    row_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(ModuleRow).where(ModuleRow.id == row_id, ModuleRow.module_id == module_id)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Row not found")
    await db.delete(row)


# ── AI Endpoints ──────────────────────────────────────────────────────────────

def _extract_json(text: str):
    """Extract JSON from AI response that may contain markdown fences."""
    text = text.strip()
    if "```" in text:
        parts = text.split("```")
        for part in parts:
            part = part.strip()
            if part.startswith("json"):
                part = part[4:].strip()
            try:
                return json.loads(part)
            except Exception:
                continue
    return json.loads(text)


class AIGenerateRequest(BaseModel):
    prompt: str
    count: int = 5


class AICreateRequest(BaseModel):
    prompt: str


@router.post("/{module_id}/ai/generate-rows", status_code=201)
async def ai_generate_rows(
    module_id: int,
    body: AIGenerateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """AI generates rows for an existing module from a text description."""
    result = await db.execute(
        select(Module).where(Module.id == module_id, Module.owner_id == user.id)
    )
    mod = result.scalar_one_or_none()
    if not mod:
        raise HTTPException(status_code=404, detail="Module not found")

    rows_result = await db.execute(
        select(ModuleRow).where(ModuleRow.module_id == module_id).order_by(ModuleRow.position)
    )
    rows = rows_result.scalars().all()

    cols = [c["name"] for c in mod.column_definitions]
    sample_ctx = ""
    if rows:
        sample_ctx = "\nExisting rows (for style reference):\n" + "\n".join(
            "  " + " | ".join(f"{c}: {r.data.get(c, '')}" for c in cols)
            for r in rows[:3]
        )

    prompt = f"""Generate exactly {body.count} knowledge rows.
Module: "{mod.name}" — {mod.description}
Columns: {cols}
User request: {body.prompt}
{sample_ctx}

Return ONLY a valid JSON array of objects. Each object must have all column keys: {cols}
No explanation, no markdown, just the JSON array.
"""
    try:
        response = await chat_completion(
            [{"role": "user", "content": prompt}],
            temperature=0.5,
            max_tokens=1800,
        )
        generated = _extract_json(response)
        if not isinstance(generated, list):
            raise ValueError("Not a list")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI generation failed: {e}")

    base_pos = len(rows)
    created = []
    for i, row_data in enumerate(generated[:body.count]):
        clean = {col: str(row_data.get(col, "")) for col in cols}
        row = ModuleRow(
            module_id=module_id,
            position=base_pos + i,
            data=clean,
            linked_row_ids=[],
            linked_knowledge_ids=[],
        )
        db.add(row)
        await db.flush()
        created.append({"id": row.id, "position": row.position, "data": clean,
                        "linked_row_ids": [], "linked_knowledge_ids": []})

    return {"created": len(created), "rows": created}


@router.post("/{module_id}/ai/suggest-links")
async def ai_suggest_module_links(
    module_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """AI analyzes rows and suggests meaningful link connections."""
    result = await db.execute(
        select(Module).where(Module.id == module_id, Module.owner_id == user.id)
    )
    mod = result.scalar_one_or_none()
    if not mod:
        raise HTTPException(status_code=404, detail="Module not found")

    rows_result = await db.execute(
        select(ModuleRow).where(ModuleRow.module_id == module_id).order_by(ModuleRow.position)
    )
    rows = rows_result.scalars().all()

    if len(rows) < 2:
        return {"suggestions": []}

    cols = [c["name"] for c in mod.column_definitions]
    rows_text = "\n".join(
        f"ID_{r.id}: " + " | ".join(f"{c}={r.data.get(c, '')}" for c in cols[:3])
        for r in rows
    )

    prompt = f"""Analyze these knowledge rows and suggest meaningful semantic connections.
Only suggest pairs that are clearly related (shared theme, cause-effect, prerequisite, etc.).
Return ONLY a JSON array, max 6 items, each with: from_id (int), to_id (int), reason (max 10 words).
Use the exact integer IDs shown after "ID_".

Rows:
{rows_text}

JSON:"""

    try:
        response = await chat_completion(
            [{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=500,
        )
        raw = _extract_json(response)
        row_ids = {r.id for r in rows}
        suggestions = []
        for s in (raw if isinstance(raw, list) else []):
            fid = int(str(s.get("from_id", 0)).replace("ID_", ""))
            tid = int(str(s.get("to_id", 0)).replace("ID_", ""))
            if fid in row_ids and tid in row_ids and fid != tid:
                suggestions.append({
                    "from_row_id": fid,
                    "to_row_id": tid,
                    "reason": str(s.get("reason", "related"))[:80],
                })
    except Exception:
        suggestions = []

    return {"suggestions": suggestions}


@router.post("/{module_id}/ai/fill-row/{row_id}")
async def ai_fill_row(
    module_id: int,
    row_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """AI fills empty cells in a row based on existing data and context."""
    result = await db.execute(
        select(Module).where(Module.id == module_id, Module.owner_id == user.id)
    )
    mod = result.scalar_one_or_none()
    if not mod:
        raise HTTPException(status_code=404, detail="Module not found")

    row_result = await db.execute(
        select(ModuleRow).where(ModuleRow.id == row_id, ModuleRow.module_id == module_id)
    )
    row = row_result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Row not found")

    others_result = await db.execute(
        select(ModuleRow).where(
            ModuleRow.module_id == module_id, ModuleRow.id != row_id
        ).limit(6)
    )
    others = others_result.scalars().all()

    cols = [c["name"] for c in mod.column_definitions]
    filled = {c: v for c, v in row.data.items() if v and v.strip()}
    empty_cols = [c for c in cols if not row.data.get(c, "").strip()]

    if not empty_cols:
        return {"data": row.data, "message": "All cells already filled"}

    context = "\n".join(
        "  " + " | ".join(f"{c}={r.data.get(c, '')}" for c in cols)
        for r in others
    )

    prompt = f"""Fill in missing knowledge data.
Module: "{mod.name}"
Row already has: {filled}
Columns to fill: {empty_cols}

Other rows for reference:
{context}

Return ONLY a JSON object with values for each missing column: {empty_cols}
Be factual and concise (under 20 words per field).
JSON:"""

    try:
        response = await chat_completion(
            [{"role": "user", "content": prompt}],
            temperature=0.4,
            max_tokens=400,
        )
        filled_data = _extract_json(response)
        new_data = dict(row.data)
        for col in empty_cols:
            if col in filled_data:
                new_data[col] = str(filled_data[col])
        row.data = new_data
        db.add(row)
        return {"data": new_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI fill failed: {e}")


@router.post("/ai/create", status_code=201)
async def ai_create_module(
    body: AICreateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """AI creates a complete module (name, columns, rows) from a text description."""
    prompt = f"""Create a structured knowledge module from this description: "{body.prompt}"

Return ONLY a valid JSON object (no markdown) with exactly these keys:
- "name": short module name, max 40 chars
- "description": one sentence
- "columns": array of 2-4 short column name strings
- "rows": array of 6-10 objects, each matching the column names with factual values

Example:
{{"name":"French Revolution","description":"Key events and figures","columns":["Name","Role","Year"],"rows":[{{"Name":"Robespierre","Role":"Politician","Year":"1793"}}]}}

JSON:"""

    try:
        response = await chat_completion(
            [{"role": "user", "content": prompt}],
            temperature=0.5,
            max_tokens=2000,
        )
        data = _extract_json(response)
        col_names = data.get("columns", ["Name", "Value"])
        cols = [{"name": c, "type": "text"} for c in col_names]

        mod = Module(
            owner_id=user.id,
            name=str(data.get("name", "AI Module"))[:50],
            description=str(data.get("description", "")),
            column_definitions=cols,
        )
        db.add(mod)
        await db.flush()

        for i, row_data in enumerate(data.get("rows", [])[:12]):
            clean = {c["name"]: str(row_data.get(c["name"], "")) for c in cols}
            row = ModuleRow(
                module_id=mod.id,
                position=i,
                data=clean,
                linked_row_ids=[],
                linked_knowledge_ids=[],
            )
            db.add(row)

        await db.flush()
        return {"id": mod.id, "name": mod.name, "description": mod.description, "columns": cols}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI creation failed: {e}")
