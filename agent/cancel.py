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

    Priority (most reliable first — Backboard was returning Connection
    errors during the hackathon, so demoted):
    1. OpenAI direct (if OPENAI_API_KEY set)
    2. Anthropic (if ANTHROPIC_API_KEY set)
    3. Google (if GOOGLE_API_KEY set)
    4. Backboard (if BACKBOARD_API_KEY set) — sponsor, OpenAI-compatible
    5. ChatBrowserUse — Browser-Use's hosted free LLM, no key required.
       Built-in retries (max_retries=5) make it the safest fallback.
    """
    from browser_use import ChatAnthropic, ChatBrowserUse, ChatGoogle, ChatOpenAI

    # Allow forcing a provider via env (useful for debugging / demo overrides).
    forced = os.getenv("BLACKMAMBA_LLM", "").strip().lower()

    if forced != "browseruse" and os.getenv("OPENAI_API_KEY"):
        return "openai", ChatOpenAI(model="gpt-4o-mini", temperature=0.0)
    if forced != "browseruse" and os.getenv("ANTHROPIC_API_KEY"):
        # Sonnet 4.6 — strongest browser-agent model accessible on this tier.
        # Override with ANTHROPIC_MODEL=claude-haiku-4-5-20251001 for speed.
        model_id = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
        return "anthropic", ChatAnthropic(model=model_id, temperature=0.0)
    if forced != "browseruse" and os.getenv("GOOGLE_API_KEY"):
        return "google", ChatGoogle(
            model="gemini-2.0-flash-exp", temperature=0.0
        )
    if forced != "browseruse" and os.getenv("BACKBOARD_API_KEY"):
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

    # Final fallback: Browser-Use's hosted LLM. No API key required for the
    # free tier; built specifically for browser-automation prompts.
    bu_key = os.getenv("BROWSER_USE_API_KEY")
    return "browseruse", ChatBrowserUse(
        model="bu-2-0",
        api_key=bu_key,
        max_retries=5,
    )


# Per-merchant cancel URL hints so the agent doesn't waste steps hunting
# for the billing page. Add entries here as we learn merchant flows.
MERCHANT_HINTS: dict[str, str] = {
    # NYTimes cancel flow lives at /subscription/cancel-survey (logged-in).
    # The bare /account page doesn't expose cancellation; go straight to source.
    "nytimes": "https://www.nytimes.com/subscription/cancel-survey",
    "new york times": "https://www.nytimes.com/subscription/cancel-survey",
    # Toronto Star — account page has the manage-subscription link.
    "toronto star": "https://www.thestar.com/account/",
    "torontostar": "https://www.thestar.com/account/",
    "thestar": "https://www.thestar.com/account/",
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


@dataclass
class ResubscribeRequest:
    merchant: str
    start_url: Optional[str]
    card_number: str
    cvc: str
    exp_month: int
    exp_year: int
    cardholder_name: str
    headless: bool
    max_steps: int


def _resubscribe_prompt(req: "ResubscribeRequest") -> str:
    effective_start = req.start_url or MERCHANT_HINTS.get(
        req.merchant.lower().strip()
    )
    return f"""You are BlackMamba, helping the user re-subscribe to {req.merchant} with a NEW virtual card. The previous card has been replaced.

GOAL: Add the new payment card to the user's {req.merchant} account and re-subscribe (or update the payment method on an existing subscription).

CARD DETAILS TO USE (paste these into the payment form):
- Card number: {req.card_number}
- Expiry: {req.exp_month:02d}/{req.exp_year}
- CVC: {req.cvc}
- Name on card: {req.cardholder_name}

Instructions:
1. {"Navigate directly to " + effective_start if effective_start else f"Find the {req.merchant} account or subscribe page."}
2. If you are not logged in, stop and report "credentials_needed".
3. Look for "Add payment method", "Update billing", "Re-subscribe", or "Subscribe" — anything that opens a payment form.
4. Fill the payment form using EXACTLY the card details above. If a billing address is required, use a plausible address (e.g. "123 Main St, Toronto, ON, M5V 2L9, Canada").
5. Submit the payment form. If a "Confirm" or "Pay now" button appears, click it.
6. Wait for a success page confirming the subscription is active or the card has been saved.
7. Report success once you see the confirmation.

Rules:
- DO NOT enter any card information other than the ones provided above.
- DO NOT use any card from autofill — always type the digits manually into the field.
- If CAPTCHA or 2FA blocks you, report "human_action_required".
- If 3D Secure / OTP is required, report "human_action_required".
- Be efficient: aim for under 20 steps.
""".strip()


def _extract_step(item, fallback_index: int) -> CancelStep:
    """Build a CancelStep from one browser-use history item. Defensive against
    schema drift across browser-use minor versions."""
    action_name = "step"
    note: Optional[str] = None
    url: Optional[str] = None
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
    except Exception as parse_err:
        log.debug("step parse fail: %s", parse_err)
    return CancelStep(index=fallback_index, action=action_name, url=url, note=note)


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
    # cookies/logins from their real profile come along for the ride.
    #
    # IMPORTANT: browser-use ALWAYS copies a non-temp user_data_dir into a
    # fresh temp directory per run (see browser_use/browser/profile.py
    # `_copy_profile`). So pointing at the user's real Chrome user-data root +
    # profile_directory='Default' means: their actual Person 1 logins get
    # cloned into a disposable workspace per agent run. The real profile is
    # never modified.
    #
    # Caveat: Chrome must not be running on that profile when the copy starts,
    # or browser-use raises with a profile-lock error. The demoer should quit
    # Chrome (Cmd+Q) before kicking off a cancel.
    chrome_path = os.getenv(
        "CHROME_BINARY_PATH",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    )
    user_data_dir = os.path.expanduser(
        os.getenv(
            "CHROME_USER_DATA_DIR",
            "~/Library/Application Support/Google/Chrome",
        )
    )
    profile_directory = os.getenv("CHROME_PROFILE_DIRECTORY", "Profile 1")
    log.info(
        "launching chrome: binary=%s user_data_dir=%s profile=%s",
        chrome_path,
        user_data_dir,
        profile_directory,
    )

    profile = BrowserProfile(
        executable_path=chrome_path,
        user_data_dir=user_data_dir,
        profile_directory=profile_directory,
        headless=req.headless,
        keep_alive=False,
    )

    browser = Browser(browser_profile=profile)

    # Force initial navigation so the LLM isn't staring at about:blank.
    # In browser-use 0.12, initial_actions run before the LLM loop kicks in.
    effective_url = req.start_url or MERCHANT_HINTS.get(
        req.merchant.lower().strip()
    )
    # browser-use 0.12 action is `navigate` (not `go_to_url`). See
    # .venv/.../browser_use/agent/service.py:459 for the default-built example.
    initial_actions = (
        [{"navigate": {"url": effective_url, "new_tab": False}}]
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
            step = _extract_step(item, i)
            if step.url:
                final_url = step.url
            steps.append(step)

        # Determine success: look for is_done on the final result entry.
        is_done = False
        if items:
            last = items[-1]
            last_results = getattr(last, "result", None) or []
            for r in last_results:
                if getattr(r, "is_done", False):
                    is_done = True
                    break

        # Detect terminal "I gave up" signals the prompt told the LLM to emit.
        # The LLM marks is_done=True with one of these phrases when it can't
        # proceed (not logged in, CAPTCHA, 2FA, etc.). Surface as an error
        # instead of a misleading success.
        terminal_error: Optional[str] = None
        last_note = (steps[-1].note or "").lower() if steps else ""
        if "credentials_needed" in last_note:
            terminal_error = "credentials_needed"
        elif "human_action_required" in last_note:
            terminal_error = "human_action_required"

        if terminal_error is not None:
            is_done = False

        duration_ms = int((time.monotonic() - start) * 1000)
        return CancelResult(
            success=is_done,
            merchant=req.merchant,
            duration_ms=duration_ms,
            steps=steps,
            final_url=final_url,
            error=(
                terminal_error
                if terminal_error is not None
                else (None if is_done else "agent_did_not_signal_done")
            ),
        )

    finally:
        try:
            await browser.close()
        except Exception:
            pass


async def run_cancel_flow_streaming(req: CancelRequest, job) -> None:
    """Streaming variant — same flow as run_cancel_flow, but updates `job` as
    each agent step completes so the UI can poll progress.

    `job` is a jobs.Job (avoid the import cycle by typing it loosely).
    """
    # Local import to avoid a circular import at module load.
    from jobs import get_lock

    start = time.monotonic()
    lock = get_lock(job.run_id)
    job.status = "running"

    try:
        from browser_use import Agent, Browser, BrowserProfile
    except ImportError as e:
        job.status = "failed"
        job.error = f"browser_use_import_failed: {e}"
        job.finished_at = time.time()
        return

    provider, llm = _pick_llm()
    log.info("[stream %s] running cancel for %s via %s", job.run_id, req.merchant, provider)

    # See run_cancel_flow above for why we point at the user's real Chrome
    # user-data root — browser-use clones it into a temp dir per run, so logins
    # come along but the real profile is never modified.
    chrome_path = os.getenv(
        "CHROME_BINARY_PATH",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    )
    user_data_dir = os.path.expanduser(
        os.getenv(
            "CHROME_USER_DATA_DIR",
            "~/Library/Application Support/Google/Chrome",
        )
    )
    profile_directory = os.getenv("CHROME_PROFILE_DIRECTORY", "Profile 1")

    profile = BrowserProfile(
        executable_path=chrome_path,
        user_data_dir=user_data_dir,
        profile_directory=profile_directory,
        headless=req.headless,
        keep_alive=False,
    )
    browser = Browser(browser_profile=profile)

    effective_url = req.start_url or MERCHANT_HINTS.get(req.merchant.lower().strip())
    initial_actions = (
        [{"navigate": {"url": effective_url, "new_tab": False}}]
        if effective_url
        else None
    )

    async def on_step_end(agent_inst) -> None:
        """Append the latest history item to the job.

        In browser-use 0.12 the history lives at agent.history (AgentHistoryList),
        whose .history is the list of AgentHistory items.
        """
        if lock is None:
            return
        try:
            history = getattr(agent_inst, "history", None)
            items = getattr(history, "history", None) if history is not None else None
            if not items:
                return
            latest = items[-1]
            async with lock:
                idx = len(job.steps)
                step = _extract_step(latest, idx)
                job.steps.append(step)
                if step.url:
                    job.final_url = step.url
        except Exception as e:
            log.debug("[stream %s] on_step_end parse fail: %s", job.run_id, e)

    agent_kwargs = dict(
        task=_task_prompt(req.merchant, req.start_url),
        llm=llm,
        browser=browser,
    )
    if initial_actions:
        agent_kwargs["initial_actions"] = initial_actions

    agent = Agent(**agent_kwargs)

    try:
        history = await agent.run(max_steps=req.max_steps, on_step_end=on_step_end)

        # Determine is_done from the final history entry.
        items = getattr(history, "history", None) or list(history)
        is_done = False
        if items:
            last = items[-1]
            last_results = getattr(last, "result", None) or []
            for r in last_results:
                if getattr(r, "is_done", False):
                    is_done = True
                    break

        terminal_error: Optional[str] = None
        if lock is not None:
            async with lock:
                last_note = (job.steps[-1].note or "").lower() if job.steps else ""
        else:
            last_note = ""
        if "credentials_needed" in last_note:
            terminal_error = "credentials_needed"
            is_done = False
        elif "human_action_required" in last_note:
            terminal_error = "human_action_required"
            is_done = False

        if lock is not None:
            async with lock:
                job.status = "success" if is_done else "failed"
                job.error = (
                    terminal_error
                    if terminal_error is not None
                    else (None if is_done else "agent_did_not_signal_done")
                )
                job.finished_at = time.time()

    except Exception as e:
        log.exception("[stream %s] agent run failed", job.run_id)
        if lock is not None:
            async with lock:
                job.status = "failed"
                job.error = f"agent_exception: {e}"
                job.finished_at = time.time()
    finally:
        try:
            await browser.close()
        except Exception:
            pass
        log.info("[stream %s] done in %dms", job.run_id, int((time.monotonic() - start) * 1000))


async def run_resubscribe_flow_streaming(req: ResubscribeRequest, job) -> None:
    """Streaming resubscribe — same machinery as run_cancel_flow_streaming but
    with a different task prompt and card details to paste."""
    from jobs import get_lock

    start = time.monotonic()
    lock = get_lock(job.run_id)
    job.status = "running"

    try:
        from browser_use import Agent, Browser, BrowserProfile
    except ImportError as e:
        job.status = "failed"
        job.error = f"browser_use_import_failed: {e}"
        job.finished_at = time.time()
        return

    provider, llm = _pick_llm()
    log.info(
        "[stream %s] resubscribe %s via %s", job.run_id, req.merchant, provider
    )

    chrome_path = os.getenv(
        "CHROME_BINARY_PATH",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    )
    user_data_dir = os.path.expanduser(
        os.getenv(
            "CHROME_USER_DATA_DIR",
            "~/Library/Application Support/Google/Chrome",
        )
    )
    profile_directory = os.getenv("CHROME_PROFILE_DIRECTORY", "Profile 1")

    profile = BrowserProfile(
        executable_path=chrome_path,
        user_data_dir=user_data_dir,
        profile_directory=profile_directory,
        headless=req.headless,
        keep_alive=False,
    )
    browser = Browser(browser_profile=profile)

    effective_url = req.start_url or MERCHANT_HINTS.get(
        req.merchant.lower().strip()
    )
    initial_actions = (
        [{"navigate": {"url": effective_url, "new_tab": False}}]
        if effective_url
        else None
    )

    async def on_step_end(agent_inst) -> None:
        if lock is None:
            return
        try:
            history = getattr(agent_inst, "history", None)
            items = (
                getattr(history, "history", None) if history is not None else None
            )
            if not items:
                return
            latest = items[-1]
            async with lock:
                idx = len(job.steps)
                step = _extract_step(latest, idx)
                job.steps.append(step)
                if step.url:
                    job.final_url = step.url
        except Exception as e:
            log.debug("[stream %s] on_step_end parse fail: %s", job.run_id, e)

    agent_kwargs = dict(
        task=_resubscribe_prompt(req),
        llm=llm,
        browser=browser,
    )
    if initial_actions:
        agent_kwargs["initial_actions"] = initial_actions

    agent = Agent(**agent_kwargs)

    try:
        history = await agent.run(
            max_steps=req.max_steps, on_step_end=on_step_end
        )
        items = getattr(history, "history", None) or list(history)
        is_done = False
        if items:
            last = items[-1]
            for r in getattr(last, "result", None) or []:
                if getattr(r, "is_done", False):
                    is_done = True
                    break

        terminal_error: Optional[str] = None
        last_note = ""
        if lock is not None:
            async with lock:
                last_note = (job.steps[-1].note or "").lower() if job.steps else ""
        if "credentials_needed" in last_note:
            terminal_error = "credentials_needed"
            is_done = False
        elif "human_action_required" in last_note:
            terminal_error = "human_action_required"
            is_done = False

        if lock is not None:
            async with lock:
                job.status = "success" if is_done else "failed"
                job.error = (
                    terminal_error
                    if terminal_error
                    else (None if is_done else "agent_did_not_signal_done")
                )
                job.finished_at = time.time()
    except Exception as e:
        log.exception("[stream %s] resubscribe failed", job.run_id)
        if lock is not None:
            async with lock:
                job.status = "failed"
                job.error = f"agent_exception: {e}"
                job.finished_at = time.time()
    finally:
        try:
            await browser.close()
        except Exception:
            pass
        log.info(
            "[stream %s] resubscribe done in %dms",
            job.run_id,
            int((time.monotonic() - start) * 1000),
        )
