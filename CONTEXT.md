# Switchback — Build Context for Aarya + Zain

**Hackathon:** TechTO Hackathon, Toronto, May 24 2026. Submit by ~5pm.
**Sponsors integrated:** Tangerine (Plaid framing), ElevenLabs (Aria voice), Backboard.io (agent brain), Codalio (credit), Rootly.ai (failure-recovery narrative).

## What Switchback is

A subscription manager where every subscription gets its own virtual card. Cancel = revoke. No retention dark patterns, no forgotten trials. Voice-driven via ElevenLabs.

**Tagline:** "The cancel button is the most valuable second in a subscriber's life. Nobody auctions it. We do."

## Aarya's archived BlackMamba plans — what we borrow

Aarya's original BlackMamba design (`docs/archive/blackmamba/`) had:

- **Shared playbook repo** for cancellation flows — matches the browser-harness self-healing model. Becomes Switchback v1 roadmap: "the 100th Netflix cancel is 20x cheaper than the 1st."
- **"Doer, not chatter"** — agent acts, only stops at genuine decision/block points. Adopted as the Switchback agent principle.
- **"User wins over LLM"** — explicit user labels override agent classification. Pitch language.
- **Local data, shared playbooks** — perfect privacy/scaling story.

The Gmail/statement ingest work in Aarya's plans is the post-hackathon v2.

## Build phases (Arav's call, 2026-05-24)

- **Phase 1 (DEMO):** Browser-Use cancellation. User clicks cancel → agent runs in Chromium → cancels live.
- **Phase 2 (post-hackathon):** Stripe Issuing virtual cards + auction modal + ElevenLabs voice. Components exist; wiring is the remaining work.

## What's built (commit `ce08556` on main)

### Backend (typechecks clean, build passes)

- `app/api/cards/route.ts` — Stripe Issuing test cards (mock fallback)
- `app/api/voice/route.ts` — ElevenLabs Aria TTS (mock fallback)
- `app/api/cancel/route.ts` — Cancel + Backboard message + savings accumulator
- `app/api/cancel-live/route.ts` — proxy to Python browser-agent on :8001
- `lib/stripe.ts`, `lib/backboard.ts`, `lib/savings-state.ts`, `lib/data.ts`

### Python agent service (`agent/`)

- FastAPI on **port 8001** (port 8000 was taken by another local service)
- `cancel.py` — Browser-Use loop, supports Backboard / OpenAI / Anthropic / Google
- `main.py` — `/health` + `/cancel` endpoints
- Venv: `cd agent && source .venv/bin/activate`

### Frontend (`app/page.tsx` — wired and live)

- 6 subs: Netflix, Spotify, Disney+, Notion, GoodLife, NYTimes
- Each card has a Cancel button → POST `/api/cancel-live` → Browser-Use runs Chromium live
- Per-card state machine: idle → running → success | error
- Animated savings counter, dark mode, Tangerine orange accent
- Aesthetic: Stripe × Linear × Robinhood. No purple. No emoji.

## Run locally (two terminals)

```bash
# Terminal 1 — Python agent
cd agent
source .venv/bin/activate
echo "BACKBOARD_API_KEY=YOUR_KEY" > .env
uvicorn main:app --port 8001 --reload

# Terminal 2 — Next.js
pnpm install   # if not already
pnpm dev
```

Then visit http://localhost:3000

## API keys

| Key                  | Where               | What for                        |
| -------------------- | ------------------- | ------------------------------- |
| `BACKBOARD_API_KEY`  | `agent/.env`        | Browser-Use LLM brain (sponsor) |
| `STRIPE_SECRET_KEY`  | `.env.local` (root) | Phase 2 — virtual card issuance |
| `ELEVENLABS_API_KEY` | `.env.local` (root) | Phase 2 — Aria voice narration  |

All routes have mock fallbacks if keys missing — the demo never visibly breaks.

## Demo target

**Primary: NYTimes.** Canonical "impossible to cancel" subscription. There's a 2023 Washington Post exposé about their hostile cancel UX. Demo line: _"NYTimes is so notorious for hostile cancellation flows that the Washington Post wrote an article about it. Watch Switchback do it in 60 seconds."_

**Backup: Spotify.** No MFA, simple flow, universal.

## Deployment

Vercel CAN'T run the Python Browser-Use service (no Chromium on serverless). **Demo from laptop**, both servers local. Vercel-deploy the Next.js for a landing-page URL post-demo.

## Coordination

- Push to main frequently. Pull before starting new work.
- In-person verbal coordination at the venue.
- Major scope change → update this file.
