# BlackMamba — NYTimes live-cancel demo plan

**Date:** 2026-05-24
**Author:** Arav + Claude
**Goal:** Live demo at TechTO showing BlackMamba agent cancelling Arav's real NYTimes subscription, with a virtual-card reveal as the wow moment. Submit by ~5pm.

---

## State (as of write-time)

- Dashboard at `app/page.tsx`: 6 subs (Netflix, Spotify, Disney+, Substack, GoodLife, NYTimes), tangerine theme, animated savings counter — **verified `next build` passes**.
- FastAPI agent at `agent/main.py` running on **`:8001`** — **`/health` returns `{status: ok, llm_provider: backboard, has_llm_key: true}`**.
- Browser-Use v0.12.8 wired to user's real Chrome at `/Applications/Google Chrome.app` with separate profile `~/.blackmamba/chrome-profile`.
- Per-merchant cancel-URL hints in `agent/cancel.py` `MERCHANT_HINTS` dict. NYTimes hint → `https://www.nytimes.com/account`.
- Phase 2 `VirtualCardReveal` overlay fires on cancel-success and animates a Stripe-Issuing card flipping in with the caption _"{merchant} can charge once. Then this card dies."_
- Latest commit on `main`: `d1aa8e0`. Aarya's parallel statement-ingestion work merged cleanly.

## Pre-flight check (Arav does once)

```bash
# 1. Verify FastAPI healthy
curl -s http://localhost:8001/health
# → {"status":"ok","llm_provider":"backboard","has_llm_key":true}

# 2. Open Chrome with BlackMamba profile (separate from your real Chrome),
#    log into NYTimes once. Profile persists, so do this only once.
open -na "Google Chrome" --args \
  --user-data-dir="$HOME/.blackmamba/chrome-profile" \
  "https://www.nytimes.com/account"

# 3. After signing in to NYTimes in that window, close the window.
#    DO NOT quit Chrome entirely if you have other Chrome windows open —
#    only close this BlackMamba-profile window.

# 4. Start the dashboard
pnpm dev
# → http://localhost:3000
```

## Demo flow (90 sec on stage)

1. **(0-15s) Hook:** "Subscriptions are the most valuable second in a subscriber's life — the cancel button. Nobody auctions it. We do."
2. **(15-25s)** Show the BlackMamba dashboard at localhost:3000. Six subs. "$1,608/yr at stake."
3. **(25-30s)** Click **Cancel** on the NYTimes card. UI flips to "Aria is canceling NYTimes…" with live elapsed counter.
4. **(30-90s)** Real Chrome window opens on screen. Aria navigates to `nytimes.com/account`. Finds Manage Subscription. Clicks Cancel. Decline retention. Confirm. Final confirmation page.
5. **(90-110s)** Result returns. Fullscreen overlay: black gradient virtual card flips in, masked PAN + last 4. Typewriter caption: _"NYTimes can charge once. Then this card dies. No retention bots. No forgotten trials."_
6. **(110-120s) Close:** "Every cancel revokes a card. We don't ask politely — we revoke at the payment layer. Built with Tangerine, ElevenLabs, Backboard.io, and Rootly."

## Risks + mitigations

| Risk                                                                      | Likelihood | Mitigation                                                            |
| ------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------- |
| Agent hits NYTimes login wall because profile session expired             | Medium     | Re-login in BlackMamba profile right before demo                      |
| NYTimes retention bot loops longer than 60s                               | Medium     | Agent prompt already says "decline ALL offers"; 300s timeout          |
| CAPTCHA on cancel page                                                    | Low-Medium | Agent reports `needs_human` — Arav clicks it manually, demo continues |
| Chrome already running with BlackMamba profile when agent tries to launch | High       | Always close the BlackMamba-profile window before clicking Cancel     |
| Backboard rate-limited at demo time                                       | Low        | Backboard has been responding cleanly all afternoon                   |
| `next build` breaks because of teammate push                              | Medium     | `npx next build` before stage; rebuild if needed                      |
| Live cancel succeeds, then VirtualCardReveal modal errors                 | Low        | Modal already has graceful error path                                 |

## What to do if the live cancel fails on stage

1. Cut to backup video (record this once it works).
2. Voice over: "On a real run earlier today, here's the agent cancelling. Live demos with retention bots can be flaky — that's exactly the problem we're solving."
3. Continue to the VirtualCardReveal narration.

## Submission checklist (right before 5pm)

- [ ] FastAPI on `:8001` healthy (`curl /health`)
- [ ] `pnpm dev` running on `:3000`
- [ ] BlackMamba Chrome profile logged into NYTimes
- [ ] Backup video recorded and on laptop desktop
- [ ] Submission form filled (GitHub repo URL, video URL, team members)
- [ ] One-line description: _"BlackMamba is an AI agent that cancels subscriptions by revoking their payment cards. Click cancel — the agent opens your browser, cancels the sub, and issues a virtual card capped at $0/mo. No retention bots. No forgotten trials."_

## Communication

- Push to `main` after each commit.
- Aarya + Zain pull, see live state in `CONTEXT.md`.
- Quorus relay is down right now — verbal coordination in person.

## Out of scope today

- Aarya's statement-ingestion work (Plans 1-3 in `docs/superpowers/plans/`). Building toward it, not shipping today.
- Vercel deploy (browser agent only works locally — laptop demo).
- ElevenLabs voice (Phase 2.5 — components wired but not voice-narrated yet).
- Auction modal (Phase 3).
