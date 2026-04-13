from sqlalchemy import String, Text, Boolean, Float, ForeignKey, DateTime, JSON, func, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime
from typing import Optional
from app.database import Base

EMBEDDING_DIM = 384  # sentence-transformers/all-MiniLM-L6-v2


class KnowledgeItem(Base):
    __tablename__ = "knowledge_items"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    content: Mapped[str] = mapped_column(Text, default="")
    summary: Mapped[str] = mapped_column(Text, default="")          # AI-generated summary
    category: Mapped[str] = mapped_column(String(100), default="General")
    tags: Mapped[list] = mapped_column(JSON, default=list)          # ["tag1","tag2"]
    source_file: Mapped[Optional[str]] = mapped_column(String(500)) # original file path/url
    source_type: Mapped[str] = mapped_column(String(50), default="manual")  # manual|file|url|ai_output

    # Visibility & marketplace
    is_public: Mapped[bool] = mapped_column(Boolean, default=False)
    price: Mapped[float] = mapped_column(Float, default=0.0)        # 0 = free when public
    rating: Mapped[float] = mapped_column(Float, default=0.0)
    rating_count: Mapped[int] = mapped_column(Integer, default=0)
    download_count: Mapped[int] = mapped_column(Integer, default=0)

    # Embedding stored as JSON text (no pgvector needed — similarity done in Python)
    # Upgrade path: replace with pgvector.sqlalchemy.Vector once pgvector is installed
    embedding: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    owner = relationship("User", back_populates="knowledge_items")
    links = relationship(
        "KnowledgeLink",
        foreign_keys="KnowledgeLink.source_id",
        back_populates="source",
        cascade="all, delete-orphan",
    )


class KnowledgeLink(Base):
    """Graph edges — link one knowledge item to another."""
    __tablename__ = "knowledge_links"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    source_id: Mapped[int] = mapped_column(ForeignKey("knowledge_items.id"), nullable=False)
    target_id: Mapped[int] = mapped_column(ForeignKey("knowledge_items.id"), nullable=False)
    label: Mapped[str] = mapped_column(String(200), default="")     # relationship label
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    source = relationship("KnowledgeItem", foreign_keys=[source_id], back_populates="links")
    target = relationship("KnowledgeItem", foreign_keys=[target_id])


class QueryHistory(Base):
    """Stores past queries for the roll-up / recent queries panel."""
    __tablename__ = "query_history"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    query_text: Mapped[str] = mapped_column(Text, nullable=False)
    answer_text: Mapped[str] = mapped_column(Text, default="")
    sources: Mapped[list] = mapped_column(JSON, default=list)       # [{title, id, excerpt}]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="query_history")


class MarketplacePurchase(Base):
    __tablename__ = "marketplace_purchases"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    buyer_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    knowledge_id: Mapped[int] = mapped_column(ForeignKey("knowledge_items.id"), nullable=False)
    amount_paid: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
