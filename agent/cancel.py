"""
Browser-Use cancel-flow runner.

Given a merchant name (and optionally a start URL), drive a headed browser
through the subscription cancellation flow. We prefer OpenAI gpt-4o-mini for
cost/latency; falls back to Anthropic or Google if the OpenAI key is missing.
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from typing import List, Optional

from pydantic import BaseModel, Field

log = logging.getLogger("switchback.cancel")


@dataclass
class CancelRequest:
    merchant: str
    start_url: Optional[str]
    headless: bool
    max_steps: int


class CancelStep(BaseModel):
    index: int
    action: str
    url: Optional[str] = None
    note: Optional[str] = None


class CancelResult(BaseModel):
    success: bool
    merchant: str
    duration_ms: int
    steps: List[CancelStep] = Field(default_factory=list)
    final_url: Optional[str] = None
    error: Optional[str] = None


def _pick_llm():
    """Return a (provider_name, langchain LLM) tuple based on available keys."""
    if os.getenv("OPENAI_API_KEY"):
        from langchain_openai import ChatOpenAI

        return "openai", ChatOpenAI(model="gpt-4o-mini", temperature=0.0)
    if os.getenv("ANTHROPIC_API_KEY"):
        from langchain_anthropic import ChatAnthropic

        return "anthropic", ChatAnthropic(
            model="claude-haiku-4-5-20251001", temperature=0.0
        )
    if os.getenv("GOOGLE_API_KEY"):
        from langchain_google_genai import ChatGoogleGenerativeAI

        return "google", ChatGoogleGenerativeAI(
            model="gemini-2.0-flash-exp", temperature=0.0
        )
    raise RuntimeError(
        "no_llm_key: set one of OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY"
    )


def _task_prompt(merchant: str, start_url: Optional[str]) -> str:
    base = f"""You are Switchback, an AI agent that cancels subscriptions on behalf of the user.

GOAL: Cancel the user's {merchant} subscription.

Instructions:
1. {"Navigate to " + start_url if start_url else f"Find the {merchant} login or account page."}
2. If a login is required and credentials are not pre-filled, stop and report "credentials_needed".
3. Locate the account / billing / subscription / membership settings page.
4. Find the cancel-subscription option. It may be hidden behind "manage plan", "membership", or similar.
5. Click cancel and confirm the cancellation through any retention prompts. Decline ALL offers to stay.
6. Wait for the final confirmation screen ("your subscription has been cancelled" or equivalent).
7. Report success.

Rules:
- Never input payment information.
- Never accept a counter-offer to stay subscribed.
- If you encounter a CAPTCHA or 2FA you cannot solve, stop and report "human_action_required".
- Be efficient: max 40 steps.
"""
    return base.strip()


async def run_cancel_flow(req: CancelRequest) -> CancelResult:
    start = time.monotonic()
    steps: List[CancelStep] = []
    final_url: Optional[str] = None

    try:
        from browser_use import Agent, Browser, BrowserConfig
    except ImportError as e:
        raise RuntimeError(
            f"browser-use not installed in this venv: {e}"
        ) from e

    provider, llm = _pick_llm()
    log.info("running cancel for %s via %s", req.merchant, provider)

    browser = Browser(
        config=BrowserConfig(
            headless=req.headless,
        )
    )

    agent = Agent(
        task=_task_prompt(req.merchant, req.start_url),
        llm=llm,
        browser=browser,
        max_failures=3,
    )

    try:
        history = await agent.run(max_steps=req.max_steps)

        for i, item in enumerate(history.history):
            action = "step"
            note = None
            url = None
            try:
                if item.model_output and item.model_output.action:
                    action = ", ".join(
                        str(list(a.model_dump().keys())[0])
                        for a in item.model_output.action
                        if a
                    )
                if item.result and item.result:
                    last = item.result[-1] if item.result else None
                    if last:
                        note = (last.extracted_content or "")[:160] or None
                if item.state:
                    url = getattr(item.state, "url", None)
                    if url:
                        final_url = url
            except Exception as parse_err:
                log.debug("step parse fail: %s", parse_err)

            steps.append(CancelStep(index=i, action=action, url=url, note=note))

        # Browser-Use marks done() to signal completion. Look for an is_done flag
        # on the last result; otherwise assume failure.
        is_done = False
        if history.history:
            last = history.history[-1]
            for r in (last.result or []):
                if getattr(r, "is_done", False):
                    is_done = True
                    break

        duration_ms = int((time.monotonic() - start) * 1000)
        return CancelResult(
            success=is_done,
            merchant=req.merchant,
            duration_ms=duration_ms,
            steps=steps,
            final_url=final_url,
            error=None if is_done else "agent_did_not_signal_done",
        )

    finally:
        try:
            await browser.close()
        except Exception:
            pass
