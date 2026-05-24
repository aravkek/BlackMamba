"""
Browser-Use cancel-flow runner (browser-use v0.12.x API).

Given a merchant name (and optionally a start URL), drive the user's real
Chrome through the subscription cancellation flow. Uses Backboard as the
LLM by default (OpenAI-compatible endpoint).
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from typing import List, Optional

from pydantic import BaseModel, Field

log = logging.getLogger("blackmamba.cancel")


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
    """Return (provider_name, llm) using browser-use's native chat classes.

    Priority:
    1. Backboard (sponsor, OpenAI-compatible) — set BACKBOARD_API_KEY
    2. OpenAI direct
    3. Anthropic
    4. Google
    """
    from browser_use import ChatAnthropic, ChatGoogle, ChatOpenAI

    if os.getenv("BACKBOARD_API_KEY"):
        base = os.getenv("BACKBOARD_BASE_URL", "https://api.backboard.io/v1")
        if not base.rstrip("/").endswith("/v1"):
            base = base.rstrip("/") + "/v1"
        model = os.getenv("BACKBOARD_MODEL", "gpt-4o-mini")
        return "backboard", ChatOpenAI(
            model=model,
            base_url=base,
            api_key=os.environ["BACKBOARD_API_KEY"],
            temperature=0.0,
        )
    if os.getenv("OPENAI_API_KEY"):
        return "openai", ChatOpenAI(model="gpt-4o-mini", temperature=0.0)
    if os.getenv("ANTHROPIC_API_KEY"):
        return "anthropic", ChatAnthropic(
            model="claude-haiku-4-5-20251001", temperature=0.0
        )
    if os.getenv("GOOGLE_API_KEY"):
        return "google", ChatGoogle(
            model="gemini-2.0-flash-exp", temperature=0.0
        )
    raise RuntimeError(
        "no_llm_key: set one of BACKBOARD_API_KEY, OPENAI_API_KEY, "
        "ANTHROPIC_API_KEY, GOOGLE_API_KEY"
    )


# Per-merchant cancel URL hints so the agent doesn't waste steps hunting
# for the billing page. Add entries here as we learn merchant flows.
MERCHANT_HINTS: dict[str, str] = {
    "nytimes": "https://www.nytimes.com/account",
    "new york times": "https://www.nytimes.com/account",
    "spotify": "https://www.spotify.com/account/subscription/",
    "netflix": "https://www.netflix.com/account",
    "disney+": "https://www.disneyplus.com/account/subscription",
    "substack": "https://substack.com/account",
    "goodlife": "https://www.goodlifefitness.com/member-portal/account.html",
    "amazon prime": "https://www.amazon.com/gp/help/customer/display.html?nodeId=GMFEGZJSYU2VMVZL",
}


def _task_prompt(merchant: str, start_url: Optional[str]) -> str:
    # Prefer the explicit start_url; otherwise use a known merchant hint.
    effective_start = start_url or MERCHANT_HINTS.get(merchant.lower().strip())

    base = f"""You are BlackMamba, an AI agent that cancels subscriptions on behalf of the user.

GOAL: Cancel the user's {merchant} subscription.

Instructions:
1. {"Navigate directly to " + effective_start if effective_start else f"Find the {merchant} login or account page."}
2. If you are NOT already logged in (you see a login form), stop and report "credentials_needed". The user is supposed to be logged in already in this Chrome profile.
3. Once on the account page, locate the subscription / billing / membership / plan section. For {merchant} specifically, look for links like "Manage subscription", "Cancel subscription", "Billing", or "Plan".
4. Click the cancel option. Read the page carefully — companies hide cancel behind "manage plan" or "downgrade".
5. Decline ALL retention offers ("wait, here's 50% off", "pause instead", "downgrade"). The user wants to fully cancel.
6. Confirm the cancellation through every prompt. Click "Confirm cancellation" / "Yes, cancel" / "I'm sure" repeatedly until you reach the final confirmation page.
7. Wait for a page that says your subscription has been cancelled (or will end on <date>). Then report success.

Rules:
- Never input payment information.
- Never accept a counter-offer to stay subscribed.
- If you encounter a CAPTCHA, stop and report "human_action_required".
- If 2FA is requested, stop and report "human_action_required".
- Be efficient: aim to finish in under 25 steps.
"""
    return base.strip()


async def run_cancel_flow(req: CancelRequest) -> CancelResult:
    start = time.monotonic()
    steps: List[CancelStep] = []
    final_url: Optional[str] = None

    try:
        from browser_use import Agent, Browser, BrowserProfile
    except ImportError as e:
        raise RuntimeError(f"browser-use not importable in this venv: {e}") from e

    provider, llm = _pick_llm()
    log.info("running cancel for %s via %s", req.merchant, provider)

    # Use the user's installed Chrome (not Playwright's bundled Chromium) so
    # cookies/logins/2FA from prior sessions are available. Use a SEPARATE
    # BlackMamba profile dir so we never collide with a running Chrome
    # instance. The demoer logs into NYTimes/Spotify into this profile ONCE
    # before the demo and the agent reuses it forever.
    chrome_path = os.getenv(
        "CHROME_BINARY_PATH",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    )
    profile_dir = os.path.expanduser(
        os.getenv("CHROME_PROFILE_DIR", "~/.blackmamba/chrome-profile")
    )
    os.makedirs(profile_dir, exist_ok=True)
    log.info("launching chrome: binary=%s profile=%s", chrome_path, profile_dir)

    profile = BrowserProfile(
        executable_path=chrome_path,
        user_data_dir=profile_dir,
        headless=req.headless,
        keep_alive=False,
    )

    browser = Browser(browser_profile=profile)

    # Force initial navigation so the LLM isn't staring at about:blank.
    # In browser-use 0.12, initial_actions run before the LLM loop kicks in.
    effective_url = req.start_url or MERCHANT_HINTS.get(
        req.merchant.lower().strip()
    )
    initial_actions = (
        [{"go_to_url": {"url": effective_url, "new_tab": False}}]
        if effective_url
        else None
    )

    agent_kwargs = dict(
        task=_task_prompt(req.merchant, req.start_url),
        llm=llm,
        browser=browser,
    )
    if initial_actions:
        agent_kwargs["initial_actions"] = initial_actions
        log.info("initial_action: go_to_url %s", effective_url)

    agent = Agent(**agent_kwargs)

    try:
        history = await agent.run(max_steps=req.max_steps)

        # v0.12 AgentHistoryList iteration — be defensive about field shapes
        # since they shift across minor versions.
        items = getattr(history, "history", None) or list(history)
        for i, item in enumerate(items):
            action_name = "step"
            note = None
            url = None
            try:
                model_output = getattr(item, "model_output", None)
                if model_output is not None:
                    actions = getattr(model_output, "action", None) or []
                    names: List[str] = []
                    for a in actions:
                        if a is None:
                            continue
                        try:
                            d = a.model_dump(exclude_none=True)
                            if d:
                                names.append(next(iter(d.keys())))
                        except Exception:
                            pass
                    if names:
                        action_name = ", ".join(names)
                results = getattr(item, "result", None) or []
                if results:
                    last = results[-1]
                    extracted = getattr(last, "extracted_content", None) or ""
                    note = extracted[:160] or None
                state = getattr(item, "state", None)
                if state is not None:
                    u = getattr(state, "url", None)
                    if u:
                        url = u
                        final_url = u
            except Exception as parse_err:
                log.debug("step parse fail: %s", parse_err)

            steps.append(CancelStep(index=i, action=action_name, url=url, note=note))

        # Determine success: look for is_done on the final result entry.
        is_done = False
        if items:
            last = items[-1]
            last_results = getattr(last, "result", None) or []
            for r in last_results:
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
