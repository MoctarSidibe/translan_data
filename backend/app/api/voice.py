"""
Voice transcription proxy — receives audio from the mobile app,
forwards to Groq Whisper API, returns transcript text.
Keeping the Groq key server-side.
"""
import httpx
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from app.models.user import User
from app.core.security import get_current_user
from app.core.config import settings

router = APIRouter(prefix="/api/voice", tags=["voice"])

GROQ_WHISPER_URL = "https://api.groq.com/openai/v1/audio/transcriptions"


@router.post("/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    audio_bytes = await file.read()
    if len(audio_bytes) < 100:
        raise HTTPException(status_code=400, detail="Audio file too small")

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            GROQ_WHISPER_URL,
            headers={"Authorization": f"Bearer {settings.GROQ_API_KEY}"},
            files={"file": (file.filename or "audio.m4a", audio_bytes, "audio/m4a")},
            data={"model": "whisper-large-v3-turbo", "response_format": "json"},
        )

    if response.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Whisper error: {response.text[:200]}")

    result = response.json()
    return {"text": result.get("text", "")}
