# BlackMamba v1 — the autonomous bank-to-agent loop

**Date:** 2026-05-24
**Authors:** Arav + Claude
**Status:** Strategy doc for post-hackathon v1

## The question this answers

How does BlackMamba talk to your bank without you uploading bills or copying card numbers, while staying safe?

## The 4-layer architecture

```
USER (one-time consent, then passive)
   │
   │ Plaid Link / Open Banking auth (30s)
   ▼
READ LAYER — Plaid + Stripe Financial Connections
   - Plaid Recurring Transactions API
   - Live transaction stream flags new recurring charges
   - Read-only (transactions, balance, account)
   - User sees ALL subs in dashboard, zero manual upload
   │
   ▼
ISSUE LAYER — Stripe Issuing (live mode, post-approval)
   - One virtual card per subscription
   - Cap = merchant price × user duration intent
   - Card auto-declines after cap, merchant cancels on their side
   - JIT funded from user's bank (no pre-deposit)
   │
   ▼
CANCEL LAYER — Browser-Use + Claude Sonnet 4.6
   - Agent navigates merchant site to cancel (today's demo)
   - Optional: belt-and-suspenders Stripe card revoke
   - Voice-driven via ElevenLabs Aria
   │
   ▼
SAFETY LAYER (cross-cutting)
   - Push notification before every card-creation event
   - One-tap revoke of BlackMamba access in Plaid dashboard
   - Per-merchant spending caps + all-time limits
   - Full audit log of every agent action
   - Agent prompt: NEVER input payment info, only use BM cards
```

## What's possible today (2026 Canada)

| Capability | Provider | Onboarding |
|---|---|---|
| Read bank txns + detect recurrence | Plaid CA (Tangerine in coverage) / Stripe Financial Connections | 30s user flow |
| Issue virtual cards | Stripe Issuing live mode (US entity + KYB) | 1-2 weeks |
| Cancel via browser agent | Browser-Use + Claude (built today) | DONE |
| Voice-driven UX | ElevenLabs (wired) | DONE |
| Push-confirmed card creation | Plaid webhooks + Tangerine native | v1 build |
| Open Banking direct to Tangerine | Canada Consumer-Driven Banking | 6-12 mo cert |

## Tangerine integration paths, ranked

1. **Plaid CA → Tangerine read access** (today): read-only, enables auto-detection. **This is the path.**
2. **Tangerine partnership** (12 mo): native integration — "BlackMamba virtual cards" as a Tangerine feature
3. **Browser-Use into Tangerine portal** (risky): agent logs into user's online banking. Anti-bot detection, credentials in agent prompt. **Skip.**

## How v1 removes / reduces human interaction safely

| Human touchpoint today | How v1 removes/reduces it |
|---|---|
| User manually finds and pastes card | **REMOVED** — BlackMamba mints virtual card on sub detection |
| User uploads bank statement | **REMOVED** — Plaid Recurring Transactions auto-imports |
| User clicks "cancel" per sub | **KEPT** (intentional consent, voice or one-tap) |
| User reviews each issued card | **REPLACED** by push notification with 5s undo |

**Safety wins because:** human stays in the consent loop for high-stakes events (card issuance, money movement), everything else is autonomous.

## Pitch positioning

> *"What you saw today is v0: connect your existing card, agent cancels. v1 (Plaid + Stripe Issuing live mode, 2 months): you connect Tangerine once via Plaid, BlackMamba auto-detects every sub, issues a per-merchant virtual card with the right cap, agent cancels when you ask. Same code we showed today, plus the read layer and the issue layer. Tangerine sees a sponsor-aligned partner that makes them the bank that fights for the customer."*

## Out of scope today (v1.5+)

- Multi-tenant SaaS deployment (today: localhost only)
- Mobile app (today: web)
- Push notification infra (today: in-page modal only)
- Voice narration of cancel events (today: text only)
- Plaid Link wiring (today: hardcoded SUBSCRIPTIONS seed data)
