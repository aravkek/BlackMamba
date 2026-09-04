# BlackMamba

**Cancels your subscription, then kills the card so it can never charge you again.**

Built in one day at the TechTO Hackathon, Toronto, May 24 2026.
Team: Arav Kekane, Aarya Prakash, Zain.

## What it does

Type "cancel Toronto Star." A browser agent opens a real Chrome session, walks the merchant's retention flow, clicks through every "are you sure," and confirms the cancellation. Verified live at the hackathon: Toronto Star cancelled in 201 seconds across 16 autonomous agent actions.

The moment cancel confirms, BlackMamba calls Stripe Issuing and mints a virtual card capped at the exact subscription price with an all-time spend limit. If the merchant ever re-bills, the card allows exactly one charge and then declines forever.

The idea: retention bots get smarter every quarter and you can't out-click them indefinitely. The durable fix is to revoke at the payment layer.

## How it's built

- `app/`, `components/`, `lib/` — Next.js front end (subscription list, cancel command, card status)
- `agent/` — Python agent service on `:8001`. Claude Sonnet via browser-use drives a dedicated Chrome profile through the cancel flow; `cancel.py` is the job, `jobs.py` the queue, `main.py` the API
- Stripe Issuing (test mode) for the single-charge virtual cards
- ElevenLabs for the voice path

See `docs/` for the design notes and plans written during the day, kept as-is.

## Running it

```bash
pnpm install && pnpm dev          # front end on :3000
cd agent && pip install -r requirements.txt && python main.py   # agent on :8001
```

Copy `.env.example` and `agent/.env.example` and fill in your own keys. Nothing in this repo runs against live money.
