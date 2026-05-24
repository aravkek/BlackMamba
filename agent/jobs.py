"""In-memory job store for streaming cancel runs.

Jobs hold per-step progress that the UI polls. Resets when the agent restarts —
fine for demo, not durable.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field

from cancel import CancelStep

JobStatus = Literal["pending", "running", "success", "failed"]


class Job(BaseModel):
    run_id: str
    merchant: str
    status: JobStatus = "pending"
    steps: List[CancelStep] = Field(default_factory=list)
    final_url: Optional[str] = None
    error: Optional[str] = None
    started_at: float = Field(default_factory=time.time)
    finished_at: Optional[float] = None

    @property
    def duration_ms(self) -> int:
        end = self.finished_at or time.time()
        return int((end - self.started_at) * 1000)

    def to_response(self) -> "JobResponse":
        return JobResponse(
            run_id=self.run_id,
            merchant=self.merchant,
            status=self.status,
            steps=self.steps,
            final_url=self.final_url,
            error=self.error,
            duration_ms=self.duration_ms,
        )


class JobResponse(BaseModel):
    """What we return to the UI on GET — includes computed duration_ms."""

    run_id: str
    merchant: str
    status: JobStatus
    steps: List[CancelStep]
    final_url: Optional[str]
    error: Optional[str]
    duration_ms: int


# Process-local store. Each Job has its own lock so step appends don't race
# with the snapshot reads from the polling endpoint.
_JOBS: Dict[str, Job] = {}
_LOCKS: Dict[str, asyncio.Lock] = {}


def create_job(merchant: str) -> Job:
    run_id = uuid.uuid4().hex[:12]
    job = Job(run_id=run_id, merchant=merchant)
    _JOBS[run_id] = job
    _LOCKS[run_id] = asyncio.Lock()
    return job


def get_job(run_id: str) -> Optional[Job]:
    return _JOBS.get(run_id)


def get_lock(run_id: str) -> Optional[asyncio.Lock]:
    return _LOCKS.get(run_id)
