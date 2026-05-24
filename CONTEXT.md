# Switchback — Build Context for Aarya + Zain

**Hackathon:** TechTO Hackathon, Toronto, May 24 2026. Submit by ~5pm.
**Sponsors to integrate:** Tangerine, ElevenLabs, Backboard.io, Codalio, Rootly.ai.

## What Switchback is

A subscription manager where every subscription gets its own virtual card. Cancel = revoke. No retention dark patterns, no forgotten trials. Voice-driven via ElevenLabs.

**Tagline:** "The cancel button is the most valuable second in a subscriber's life. Nobody auctions it. We do."

## Build phases (Arav's call, 2026-05-24)

- **Phase 1 (now):** Browser-harness cancellation. User clicks cancel → agent goes to merchant site and actually cancels.
- **Phase 2 (after Phase 1 works):** Stripe Issuing virtual cards + auction modal + ElevenLabs Aria voice.

## What's built so far

### Backend (working, typechecks clean)

- `app/api/cards/route.ts` — Stripe Issuing test card creation (with mock fallback if no key)
- `app/api/voice/route.ts` — ElevenLabs Aria TTS (with mock fallback)
- `app/api/cancel/route.ts` — Cancel logic + Backboard agent message + cumulative savings
- `lib/stripe.ts` — Stripe client + cardholder bootstrap
- `lib/backboard.ts` — Backboard.io agent (OpenAI-compatible) with deterministic fallback
- `lib/savings-state.ts` — In-memory savings accumulator
- `lib/data.ts` — 5 hardcoded subs (Netflix, Spotify, Disney+, Notion, GoodLife) + bid data for auction

### Frontend components (built but NOT wired into page.tsx yet)

- `components/SubscriptionCard.tsx`
- `components/AuctionModal.tsx` — fullscreen Netflix→Crave/Tubi/Apple TV+ auction
- `components/VirtualCardReveal.tsx` — card flip + typewriter
- `components/AnimatedCounter.tsx`
- `components/BrandMark.tsx`
- `components/ui/Button.tsx`, `Card.tsx`

### What needs doing next

1. **Wire `app/page.tsx`** to use the components above (currently default scaffold)
2. **Browser-harness service** (Phase 1) — Browser-Use or Stagehand
3. **End-to-end test** — click cancel → browser opens → cancels → UI updates
4. **Vercel deploy + custom domain**
5. **5x demo rehearsal + backup video**

## API keys needed in `.env.local`

```
STRIPE_SECRET_KEY=sk_test_...
ELEVENLABS_API_KEY=...
BACKBOARD_API_KEY=...
```

(See `.env.example`.) All routes have graceful fallbacks if keys are missing.

## Run

```bash
pnpm install
pnpm run dev
```

## Coordination

- Push frequently. Pull before starting new work.
- Branch naming: `feat/<thing>` or `fix/<thing>`. PRs to main.
- Any major scope change → update this CONTEXT.md.
