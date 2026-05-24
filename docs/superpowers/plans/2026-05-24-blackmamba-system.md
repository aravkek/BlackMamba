# BlackMamba — How It Works (system overview)

**Last verified:** 2026-05-24, commit on `main`
**Live demo target:** Toronto Star (Chargebee retention bot, web-cancel)

---

## Stack at a glance

```
                    ┌──────────────────────────────────────┐
                    │ User's main browser → localhost:3000 │
                    └─────────────────┬────────────────────┘
                                      │
              ┌───────────────────────▼────────────────────────┐
              │   Next.js 16 dashboard (app/page.tsx)          │
              │   - Chat-driven UI (type "cancel my X")        │
              │   - Subscription rail (6 brands)               │
              │   - "BlackMamba Wallet" section (live)         │
              │   - VirtualCardReveal fullscreen overlay       │
              └───┬──────────┬──────────┬───────────┬──────────┘
                  │          │          │           │
                  ▼          ▼          ▼           ▼
              /api/chat  /api/cancel /api/cards /api/wallet
              (LLM +     -live      (Stripe    (read-only
              tool       (proxy to  Issuing    list of
              calls)     Python)    test mode) issued cards)
                              │          │
                              │          ▼
                              │     lib/wallet-state.ts
                              │     (in-memory ledger)
                              ▼
                  ┌───────────────────────────┐
                  │ FastAPI agent (:8001)     │
                  │ uvicorn main:app          │
                  └──────────┬────────────────┘
                             │
                             ▼
                  ┌───────────────────────────┐
                  │ browser-use v0.12.8       │
                  │ + Claude Sonnet 4.6       │
                  │ + USER'S REAL CHROME      │
                  │ + BlackMamba profile dir  │
                  └───────────────────────────┘
```

## The four moving parts

### 1. Dashboard — `app/page.tsx` + `components/`

- Single page at `localhost:3000`
- Chat input drives everything (no buttons for cancel — typed)
- Subscription rail shows 6 brands seeded in `lib/data.ts` (Netflix, Spotify, Disney+, Toronto Star, GoodLife, NYTimes)
- "ANNUAL AT-STAKE" hero with animated counter
- "BLACKMAMBA WALLET" section shows every virtual card issued (one per cancelled merchant)
- Fullscreen `VirtualCardReveal` flips in on every successful cancel

### 2. Chat router — `app/api/chat/route.ts` + `lib/chat/tools.ts`

- POSTs to Claude (Anthropic) with the user's message
- Claude responds with tool calls (e.g. `cancel_subscription(service: "Toronto Star")`)
- Server executes each tool via `TOOL_EXECUTORS` registry in `lib/chat/tools.ts`
- For cancel: tool calls Python agent on `localhost:8001/cancel` and waits up to 5min
- Returns assistant message + tool results to client

### 3. Python browser agent — `agent/`

- FastAPI on `:8001`, `uvicorn main:app --port 8001`
- `cancel.py` runs `browser-use 0.12.8` against the user's real Chrome (separate `~/.blackmamba/chrome-profile` so it never collides with running Chrome)
- LLM priority: OpenAI > Anthropic > Google > Backboard > Browser-Use hosted free fallback
- Currently using **Claude Sonnet 4.6** via Anthropic key
- `MERCHANT_HINTS` dict maps merchant name → known cancel URL so agent skips the search step
- Forces initial navigation with `initial_actions=[{"navigate": {...}}]` before LLM loop starts

### 4. Stripe wallet — `app/api/cards`, `app/api/wallet`, `lib/wallet-state.ts`

- `/api/cards` (POST): creates a real Stripe Issuing test card (or mock if no key). Calls `addWalletCard` to persist.
- `/api/wallet` (GET): returns the in-memory ledger of all cards minted
- `lib/wallet-state.ts`: dedups per merchant; newest first; tracks status active/revoked
- `VirtualCardReveal` component drives the issuance internally — fires after every cancel success

## End-to-end demo flow

1. User opens `localhost:3000`
2. Types in chat: _"Cancel my Toronto Star subscription"_
3. `/api/chat` → Claude → tool call `cancel_subscription({service: "Toronto Star"})`
4. Server executes tool → POST `localhost:8001/cancel` with `{merchant: "Toronto Star"}`
5. Python agent launches **real Chrome** with BlackMamba profile (logged into Toronto Star)
6. Agent navigates `thestar.com/account` → Subscriptions → Cancel → Chargebee retention → declines offer → confirms
7. Returns `{success: true, steps: [...16 actions]}` to the chat tool
8. Client sees success → fires `VirtualCardReveal` overlay
9. `VirtualCardReveal` POSTs `/api/cards` → mints Stripe Issuing card → persists to wallet
10. Wallet section re-fetches `/api/wallet` → new "TORONTO STAR · ACTIVE · 4242" card appears in BlackMamba Wallet

## What's verified working RIGHT NOW

- ✅ Live Toronto Star cancellation through Chargebee retention bot (commit `04ed36a`, 16 steps, 201s, success:true)
- ✅ Dashboard renders at `localhost:3000` (HTTP 200)
- ✅ FastAPI agent healthy at `localhost:8001/health` (provider: anthropic)
- ✅ `/api/wallet` returns the in-memory card list
- ✅ Sonnet 4.6 is the active LLM for the browser agent

## What's still mocked / fallback

- Stripe Issuing card: returns `MOCK_CARD` (4242 4242 4242 4242) unless `STRIPE_SECRET_KEY` is set. Wallet still populates with the mock card so the demo looks identical.
- ElevenLabs voice: never wired into the chat flow today. Components exist for Phase 2.5.

## Running it (two terminals)

```bash
# Terminal 1 — Python agent
cd agent
source .venv/bin/activate
uvicorn main:app --port 8001

# Terminal 2 — Next.js
npx next dev --port 3000   # bypass pnpm preflight
```

## Sponsors actually integrated (truthful)

| Sponsor                       | Where it shows up                                                                                 | Real or framing? |
| ----------------------------- | ------------------------------------------------------------------------------------------------- | ---------------- |
| Anthropic / Claude Sonnet 4.6 | Powers the browser agent (decides every click)                                                    | Real             |
| Browser-Use                   | The agentic harness driving real Chrome                                                           | Real             |
| Tangerine                     | Framing (Canadian-bank narrative) — would be Plaid sandbox in v1                                  | Framing          |
| ElevenLabs                    | Aria voice components wired but not active today                                                  | Framing          |
| Backboard.io                  | Their API turned out to be Assistants/Threads, not OpenAI-compatible. Listed as fallback in code. | Framing          |
| Codalio                       | Credit on slide                                                                                   | Framing          |
| Rootly.ai                     | "Incident response for cancel-agent failures" narrative                                           | Framing          |
