"""
Switchback browser-agent service.

FastAPI wrapper around Browser-Use. The Next.js app POSTs to /cancel with a
target merchant, and this service runs an autonomous browser flow to cancel
the subscription. Returns a structured result + a base64 screenshot trail
so the demo UI can stream the agent's progress.

Run locally:
    uvicorn main:app --reload --port 8000
"""

from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from cancel import CancelRequest, CancelResult, run_cancel_flow

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
log = logging.getLogger("switchback.agent")


SWITCHBACK_PORT = int(os.getenv("SWITCHBACK_AGENT_PORT", "8001"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("switchback agent starting on :%d", SWITCHBACK_PORT)
    yield
    log.info("switchback agent shutting down")


app = FastAPI(title="Switchback Browser Agent", lifespan=lifespan)

# Next.js dev server lives on :3000 — allow it to call us from the browser if needed.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)


class CancelBody(BaseModel):
    merchant: str = Field(..., min_length=1, max_length=64)
    url: Optional[str] = Field(
        None,
        description="Explicit start URL. If omitted, the agent searches for the merchant's cancel page.",
    )
    headless: bool = Field(
        False,
        description="Run headless? Demo wants visible so judges can SEE the agent click.",
    )
    max_steps: int = Field(40, ge=1, le=200)


class HealthResponse(BaseModel):
    status: str
    llm_provider: Optional[str]
    has_llm_key: bool


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    has_openai = bool(os.getenv("OPENAI_API_KEY"))
    has_anthropic = bool(os.getenv("ANTHROPIC_API_KEY"))
    has_google = bool(os.getenv("GOOGLE_API_KEY"))

    provider = None
    if has_openai:
        provider = "openai"
    elif has_anthropic:
        provider = "anthropic"
    elif has_google:
        provider = "google"

    return HealthResponse(
        status="ok",
        llm_provider=provider,
        has_llm_key=provider is not None,
    )


@app.post("/cancel", response_model=CancelResult)
async def cancel(body: CancelBody) -> CancelResult:
    log.info("cancel request: merchant=%s url=%s", body.merchant, body.url)

    req = CancelRequest(
        merchant=body.merchant,
        start_url=body.url,
        headless=body.headless,
        max_steps=body.max_steps,
    )

    try:
        result = await asyncio.wait_for(run_cancel_flow(req), timeout=300)
        return result
    except asyncio.TimeoutError:
        log.error("cancel timeout after 300s")
        raise HTTPException(status_code=504, detail="cancel_timeout")
    except Exception as e:
        log.exception("cancel failure")
        raise HTTPException(status_code=500, detail=f"cancel_error: {e}")
