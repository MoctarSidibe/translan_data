"""
File and URL parser — extracts clean text from local files and web pages.
Supports: PDF, DOCX, TXT, CSV, images (OCR later), web URLs, YouTube transcripts.
"""
import os
import httpx
from pathlib import Path
from typing import Optional


async def parse_file(file_path: str) -> tuple[str, str]:
    """
    Parse a local file and return (title, content).
    """
    path = Path(file_path)
    ext = path.suffix.lower()
    title = path.stem

    if ext == ".pdf":
        content = _parse_pdf(file_path)
    elif ext in (".docx", ".doc"):
        content = _parse_docx(file_path)
    elif ext in (".txt", ".md"):
        content = path.read_text(encoding="utf-8", errors="ignore")
    elif ext == ".csv":
        content = _parse_csv(file_path)
    else:
        content = f"[Unsupported file type: {ext}]"

    return title, content.strip()


def _parse_pdf(path: str) -> str:
    from pypdf import PdfReader
    reader = PdfReader(path)
    pages = []
    for page in reader.pages:
        text = page.extract_text()
        if text:
            pages.append(text)
    return "\n\n".join(pages)


def _parse_docx(path: str) -> str:
    from docx import Document
    doc = Document(path)
    return "\n".join(p.text for p in doc.paragraphs if p.text.strip())


def _parse_csv(path: str) -> str:
    import csv
    rows = []
    with open(path, newline="", encoding="utf-8", errors="ignore") as f:
        reader = csv.reader(f)
        for row in reader:
            rows.append(" | ".join(row))
    return "\n".join(rows)


async def parse_url(url: str) -> tuple[str, str]:
    """Scrape a web page and return (title, content)."""
    async with httpx.AsyncClient(follow_redirects=True, timeout=30) as client:
        response = await client.get(url, headers={"User-Agent": "TranslanData/1.0"})
        response.raise_for_status()
        html = response.text

    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")

    # Extract title
    title_tag = soup.find("title")
    title = title_tag.get_text(strip=True) if title_tag else url

    # Remove scripts, styles, nav, footer
    for tag in soup(["script", "style", "nav", "footer", "header", "aside", "form"]):
        tag.decompose()

    # Get main content
    main = soup.find("main") or soup.find("article") or soup.find("body")
    if main:
        content = main.get_text(separator="\n", strip=True)
    else:
        content = soup.get_text(separator="\n", strip=True)

    # Clean up excessive blank lines
    lines = [line.strip() for line in content.splitlines() if line.strip()]
    content = "\n".join(lines)

    return title, content[:50000]  # cap at 50k chars


async def chunk_text(text: str, chunk_size: int = 800, overlap: int = 100) -> list[str]:
    """Split text into overlapping chunks for embedding."""
    words = text.split()
    chunks = []
    i = 0
    while i < len(words):
        chunk = " ".join(words[i : i + chunk_size])
        chunks.append(chunk)
        i += chunk_size - overlap
    return chunks
