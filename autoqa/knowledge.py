from __future__ import annotations

import asyncio
import hashlib
import json
import os
import sys
import urllib.parse
import urllib.request
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "autoqa-data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
TXT_CACHE = DATA_DIR / "txtai"
LIGHT_CACHE = DATA_DIR / "lightrag"
EMAIL_UPDATES_FILE = ROOT / "autoqa" / "knowledge" / "email-process-updates.txt"
AI_MEMORY_URL = "http://127.0.0.1:49374"
OLLAMA_URL = "http://127.0.0.1:11434"
OLLAMA_MODEL = "qwen3:8b"
EMBED_MODEL = "nomic-embed-text:latest"


def chunks(text: str) -> list[str]:
    lines = [line.strip() for line in str(text or "").splitlines() if line.strip()]
    out: list[str] = []
    heading = ""
    buffer: list[str] = []

    def flush() -> None:
        nonlocal buffer
        if not buffer:
            return
        body = "\n".join(buffer).strip()
        if body:
            out.append(f"{heading}\n{body}".strip())
        buffer = []

    for line in lines:
        if line.startswith("## ") or line.endswith(" — NON-REFUNDABLE REFUND HANDLING") or line.startswith("0"):
            flush()
            heading = line
            continue
        buffer.append(line)
        if len("\n".join(buffer)) >= 900:
            flush()
    flush()
    return out or [str(text or "").strip()]


def lexical(matrix_text: str, query: str, limit: int = 12) -> list[str]:
    stop = {
        "the", "and", "for", "that", "with", "from", "this", "have", "will", "was",
        "are", "but", "not", "you", "your", "guest", "agent", "call", "hotel", "booking",
    }
    words = {w for w in ''.join(c if c.isalnum() else ' ' for c in query.lower()).split() if len(w) >= 3 and w not in stop}
    ranked: list[tuple[float, str]] = []
    for block in chunks(matrix_text):
        low = block.lower()
        score = sum((3 if len(w) >= 8 else 1) for w in words if w in low)
        if any(k in low for k in ("refund", "voucher", "foc", "slack", "ticket", "supplier", "cancel", "rebook", "supervisor")):
            score += 0.25
        if score > 0:
            ranked.append((score, block))
    ranked.sort(key=lambda item: item[0], reverse=True)
    return [item[1] for item in ranked[:limit]]


def txtai_retrieve(matrix_text: str, query: str, limit: int = 12) -> list[str]:
    try:
        from txtai import Embeddings
    except Exception:
        return []

    blocks = chunks(matrix_text)
    if not blocks:
        return []

    try:
        embeddings = Embeddings({
            "path": "sentence-transformers/all-MiniLM-L6-v2",
            "content": True,
            "backend": "faiss",
        })
        embeddings.index([(i, block, None) for i, block in enumerate(blocks)])
        results = embeddings.search(query, limit)
        found: list[str] = []
        for item in results:
            if isinstance(item, dict):
                text = str(item.get("text") or item.get("data") or "").strip()
                if text:
                    found.append(text)
            elif isinstance(item, (tuple, list)) and item:
                idx = item[0]
                if isinstance(idx, int) and 0 <= idx < len(blocks):
                    found.append(blocks[idx])
        return found
    except Exception:
        return []


def read_email_updates() -> str:
    try:
        return EMAIL_UPDATES_FILE.read_text(encoding="utf-8")
    except Exception:
        return ""


def email_updates_retrieve(query: str, limit: int = 10) -> list[str]:
    text = read_email_updates()
    if not text.strip():
        return []
    found = txtai_retrieve(text, query, limit)
    if not found:
        found = lexical(text, query, limit)
    return found[:limit]


def ai_memory_retrieve(query: str, limit: int = 6) -> list[str]:
    try:
        params = urllib.parse.urlencode({"q": query[:1200], "limit": str(limit)})
        request = urllib.request.Request(
            f"{AI_MEMORY_URL}/api/v1/search?{params}",
            headers={"Accept": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=1.5) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception:
        return []

    values = payload.get("results") or payload.get("hits") or payload.get("pages") or []
    out: list[str] = []
    for item in values:
        if not isinstance(item, dict):
            continue
        text = str(
            item.get("snippet")
            or item.get("body")
            or item.get("text")
            or item.get("title")
            or ""
        ).strip()
        if text:
            out.append(text[:1800])
    return out[:limit]


async def lightrag_retrieve(matrix_text: str, query: str) -> str:
    try:
        from lightrag import LightRAG, QueryParam
        from lightrag.llm.ollama import ollama_model_complete, ollama_embed
        from lightrag.utils import EmbeddingFunc
    except Exception:
        return ""

    digest = hashlib.sha256(matrix_text.encode("utf-8", errors="ignore")).hexdigest()[:16]
    workdir = LIGHT_CACHE / digest
    workdir.mkdir(parents=True, exist_ok=True)
    marker = workdir / ".indexed"

    try:
        rag = LightRAG(
            working_dir=str(workdir),
            llm_model_func=ollama_model_complete,
            llm_model_name=OLLAMA_MODEL,
            llm_model_kwargs={
                "host": OLLAMA_URL,
                "options": {"num_ctx": 8192},
                "timeout": 300,
            },
            embedding_func=EmbeddingFunc(
                embedding_dim=768,
                max_token_size=8192,
                func=partial(
                    ollama_embed.func,
                    embed_model=EMBED_MODEL,
                    host=OLLAMA_URL,
                ),
            ),
        )
        await rag.initialize_storages()
        if not marker.exists():
            await rag.ainsert(matrix_text)
            marker.write_text("ok", encoding="utf-8")
        result = await rag.aquery(
            query[:5000],
            param=QueryParam(mode="hybrid", only_need_context=True),
        )
        try:
            await rag.finalize_storages()
        except Exception:
            pass
        return str(result or "")[:10000]
    except Exception:
        return ""


def retrieve(payload: dict) -> dict:
    matrix_text = str(payload.get("matrixText") or "")
    query = str(payload.get("query") or "")
    deep = bool(payload.get("deep"))

    txt = txtai_retrieve(matrix_text, query)
    if not txt:
        txt = lexical(matrix_text, query)

    email_updates = email_updates_retrieve(query)
    memory = ai_memory_retrieve(query)
    deep_text = ""
    if deep and matrix_text.strip():
        try:
            deep_text = asyncio.run(lightrag_retrieve(matrix_text, query))
        except Exception:
            deep_text = ""

    sections: list[str] = []
    if txt:
        sections.append("PRIMARY SERVICE MATRIX RETRIEVAL:\n" + "\n\n".join(txt[:12]))
    if email_updates:
        sections.append(
            "SUPPLEMENTAL EMAIL PROCESS UPDATES — USE ONLY WHEN THE ACTIVE SERVICE MATRIX DOES NOT CLEARLY ANSWER THE ISSUE:\n"
            + "\n\n".join(email_updates[:10])
        )
    if deep_text:
        sections.append("LIGHTRAG DEEP RETRIEVAL:\n" + deep_text)
    if memory:
        sections.append("LOCAL QA MEMORY RECALL:\n" + "\n\n".join(memory[:6]))

    return {
        "ok": True,
        "txtai": bool(txt),
        "emailUpdates": bool(email_updates),
        "lightrag": bool(deep_text),
        "aiMemory": bool(memory),
        "context": "\n\n".join(sections)[:26000],
    }


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        action = str(payload.get("action") or "retrieve")
        if action != "retrieve":
            print(json.dumps({"ok": False, "error": "Unsupported action"}))
            return 2
        print(json.dumps(retrieve(payload), ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)[:500]}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
