from sqlalchemy import String, Text, Boolean, ForeignKey, DateTime, JSON, Integer, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime
from typing import Optional
from app.database import Base


class Module(Base):
    """A table/module in Learning Mode (like an Obsidian page but structured)."""
    __tablename__ = "modules"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(100), default="General")
    tags: Mapped[list] = mapped_column(JSON, default=list)
    column_definitions: Mapped[list] = mapped_column(JSON, default=list)
    # [{"name": "Name", "type": "text"}, {"name": "Value", "type": "number"}, ...]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    owner = relationship("User", back_populates="modules")
    rows = relationship("ModuleRow", back_populates="module", cascade="all, delete-orphan",
                        order_by="ModuleRow.position")


class ModuleRow(Base):
    """A single data row inside a Module."""
    __tablename__ = "module_rows"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    module_id: Mapped[int] = mapped_column(ForeignKey("modules.id"), nullable=False, index=True)
    position: Mapped[int] = mapped_column(Integer, default=0)       # auto position
    data: Mapped[dict] = mapped_column(JSON, default=dict)          # {"col_name": value, ...}
    image_path: Mapped[Optional[str]] = mapped_column(String(500))  # joined image
    linked_row_ids: Mapped[list] = mapped_column(JSON, default=list) # [row_id, ...]  link arrows
    linked_knowledge_ids: Mapped[list] = mapped_column(JSON, default=list)  # link to KnowledgeItem
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    module = relationship("Module", back_populates="rows")
