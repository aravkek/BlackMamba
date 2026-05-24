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

from cancel import CancelRequest, CancelResult, run_cancel_flow, run_cancel_flow_streaming
from jobs import JobResponse, create_job, get_job

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
    # Match the priority in cancel._pick_llm() (Backboard demoted after
    # Connection errors during the hackathon).
    provider: Optional[str] = None
    forced = os.getenv("BLACKMAMBA_LLM", "").strip().lower()
    if forced != "browseruse" and os.getenv("OPENAI_API_KEY"):
        provider = "openai"
    elif forced != "browseruse" and os.getenv("ANTHROPIC_API_KEY"):
        provider = "anthropic"
    elif forced != "browseruse" and os.getenv("GOOGLE_API_KEY"):
        provider = "google"
    elif forced != "browseruse" and os.getenv("BACKBOARD_API_KEY"):
        provider = "backboard"
    else:
        # Browser-Use hosted free LLM — no key required.
        provider = "browseruse"

    # Even on browseruse fallback we report has_llm_key=True since the
    # service works without a key.
    return HealthResponse(
        status="ok",
        llm_provider=provider,
        has_llm_key=True,
    )


class StartCancelResponse(BaseModel):
    run_id: str
    merchant: str


@app.post("/cancel/start", response_model=StartCancelResponse)
async def cancel_start(body: CancelBody) -> StartCancelResponse:
    """Fire-and-forget: kick off the cancel run, return a run_id immediately."""
    log.info("cancel/start: merchant=%s", body.merchant)
    job = create_job(merchant=body.merchant)
    req = CancelRequest(
        merchant=body.merchant,
        start_url=body.url,
        headless=body.headless,
        max_steps=body.max_steps,
    )
    # Background task — don't await it here.
    asyncio.create_task(run_cancel_flow_streaming(req, job))
    return StartCancelResponse(run_id=job.run_id, merchant=job.merchant)


@app.get("/cancel/runs/{run_id}", response_model=JobResponse)
async def cancel_run_state(run_id: str) -> JobResponse:
    job = get_job(run_id)
    if job is None:
        raise HTTPException(status_code=404, detail="run_not_found")
    return job.to_response()


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
