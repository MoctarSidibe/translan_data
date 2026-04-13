from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from app.core.config import settings
from app.database import create_tables
from app.api import auth, query, knowledge, files, marketplace, modules, voice, payment


@asynccontextmanager
async def lifespan(app: FastAPI):
    await create_tables()
    yield


app = FastAPI(
    title="Translan Data API",
    version="1.0.0",
    description="Personal AI Knowledge Management — Backend",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(query.router)
app.include_router(knowledge.router)
app.include_router(files.router)
app.include_router(marketplace.router)
app.include_router(modules.router)
app.include_router(voice.router)
app.include_router(payment.router)


@app.get("/")
async def root():
    return {"app": settings.APP_NAME, "status": "running", "version": "1.0.0"}


@app.get("/health")
async def health():
    return {"status": "ok"}
