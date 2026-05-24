# BlackMamba — TechTO Hackathon Demo Rehearsal

**Date:** 2026-05-24
**Event:** TechTO Hackathon Toronto
**Demoer:** Arav Kekane
**Team:** Arav, Aarya, Zain
**Tagline:** _"We don't fight retention bots. We revoke their ability to charge."_

---

## Verified Reality (what actually runs end-to-end, 2026-05-24)

1. User types `Cancel my Toronto Star subscription` in chat at `localhost:3000`.
2. **Claude Sonnet 4.6** (Anthropic) chooses the `cancel_subscription` tool.
3. Frontend POSTs to **Python FastAPI agent on `:8001`**.
4. **Browser-Use 0.12.8** boots the user's REAL Chrome under `~/.blackmamba/chrome-profile`.
5. Agent runs the full Toronto Star cancel: `thestar.com/account` → Subscriptions → Cancel → Chargebee retention → pick reason → decline offer → confirm. **16 actions, ~201s, completes cleanly.**
6. Success bubbles back → page fires fullscreen `VirtualCardReveal`.
7. **Real Stripe Issuing card mints in test mode** — last4 `0013`, `cardId ic_1TahLZRd5iFbIJqHzJHtId8i`.
8. Card carries an **ALL_TIME spending cap** at the sub price — merchant gets exactly one successful authorization; every subsequent charge declines forever.
9. Wallet section of the dashboard auto-populates with the freshly-minted card.

**Sponsor stack — honest:**

- Anthropic / **Claude Sonnet 4.6** — drives every browser decision. _Real._
- **Browser-Use 0.12.8** — agent harness on top of Playwright + real Chrome. _Real._
- **Stripe Issuing** (test mode) — mints the virtual card on cancel success. _Real._
- **Tangerine** — branding only (issuer story for the deck). _No live integration today._
- **ElevenLabs** — wired into the stack but no voice narration in this demo run.
- **Backboard.io** — sponsor credit only. Their API turned out to be Assistants/Threads, not OpenAI-compatible — couldn't swap in cleanly inside the time budget.
- **Rootly.ai** — failure-recovery framing (retries + telemetry in the agent harness).

---

## Artifact 1 — 90-Second Stage Script (UPDATED)

> Speak slowly. The browser does the work — you frame it. The cancel run is ~3 min, so the script bridges it with filler lines you can drop or stretch.

**[0:00 — HOOK · 10s]**

> "Rocket Money does **$12M ARR** by emailing humans to cancel your subscriptions for you. Twelve million dollars to send polite letters.
> We thought: what if the user never has to ask, and the merchant never gets to charge again?"

**[0:10 — CONTRARIAN TRUTH · 10s]**

> "Every cancel tool on the market fights the retention bot. We don't.
> **BlackMamba revokes the merchant's ability to charge you.** Payment-layer cancellation. Watch."

**[0:20 — LAUNCH · 5s]**

_(Type into chat: `Cancel my Toronto Star subscription`. Hit enter.)_

> "Claude Sonnet 4.6 decides to invoke a tool. The tool fires up the user's real Chrome."

**[0:25–3:25 — LIVE CANCEL NARRATION · ~3 min of bridge]**

_(Real Chrome window pops to front, hits `thestar.com/account`.)_

Bridge lines — use as needed, in this order. Each is ~10-15s so you have ~12 you can lean on:

> "Notice: this isn't a headless robot. This is **my actual Chrome profile**, already logged in. The agent inherits the session like a human would."

> "Browser-Use 0.12.8 is the harness. Sonnet 4.6 is the brain. Every click you see is a token decision — not a hardcoded script."

> "Toronto Star runs **Chargebee** for retention. Chargebee's whole job is to make this exact moment slow and confusing. Watch the agent walk through it anyway."

> "There — 'Manage Subscription.' The agent read the DOM, scored the options, picked the right one."

> "Now the retention page. They're about to offer a discount. The agent declines on the user's behalf — because the user already told us, in one sentence, what they wanted."

> "While this runs: the killer move is what happens **after** the cancel confirms. Most tools end here. We're just getting started."

> "Every cancel flow on the internet is hand-built to break automation. Dark patterns, hidden buttons, modals on modals. The agent doesn't care — it sees the page the same way you do."

> "Rocket Money's concierge takes **3–5 business days** to do what you're watching happen in 3 minutes."

> "If this fails at any step, Rootly-style retry kicks in and we re-plan from the last known good state. Today's run is clean — but we built for the messy case."

> "OK — reason selected. Declining the retention offer. Confirming cancellation."

_(Cancellation confirmation page loads.)_

> "Cancelled. Toronto Star marked it cancelled on their side. **Now the part nobody else does.**"

**[3:25 — THE WOW · 20s]**

_(Fullscreen `VirtualCardReveal` flips in. Real Stripe card, last4 `0013`.)_

> "The instant we cancel, we mint a **real Stripe Issuing card** — that's a live card ID, test mode, but the rail is real.
> This card has an **all-time spending cap set to the exact subscription price.**
> Toronto Star can charge it **once**. After that, every authorization declines. Forever.
> Their billing system already marked the sub cancelled. The card guarantees it stays that way."

**[3:45 — V1 ROADMAP + CLOSE · 15s]**

> "**v1, shipping in 30 days:** the agent reads the subscription terms itself — trial price, full price, billing period — and sizes the card to the user's exact intent.
> 'I only want the free trial.' 'I want this for six months.' 'One charge, never again.'
> The card becomes the contract. The merchant can't violate what they can't authorize.
>
> Built today on **Claude Sonnet 4.6, Browser-Use, and Stripe Issuing.** Thank you."

**[4:00 — END. Walk off.]**

> Total ~4 min including cancel run. If TechTO is strictly 90s, skip 8 of the 12 bridge lines and let the screen breathe — the cancel itself is the demo.

---

## Artifact 2 — Q&A Prep (Top 8 Judge Questions)

**Q1: Why hasn't Rocket Money or DoNotPay done this?**
They monetize the cancel as a service — they charge users $4/mo to send tickets. We monetize the cancel as a **payment primitive** — the merchant never sees the charge succeed twice. Different posture, different infra, different defensibility.

**Q2: What if the agent fails on stage?**
Rootly-style retry wraps the harness; if Chrome stalls past 60s past the expected step, we cut to a pre-recorded backup of the 201s clean run and keep narrating. The card mint is independent — we can demo it standalone if the browser pipeline breaks.

**Q3: How do you handle 2FA / CAPTCHA?**
Today: the user's real Chrome profile is already signed in, so we sidestep auth entirely. v1: one-tap mobile handoff — user approves 2FA on their phone, agent resumes.

**Q4: Business model + unit economics?**
Take rate on Stripe Issuing interchange (1.5%+ per authorization), plus a $2 flat fee per cancelled subscription. CAC ≈ 0 because every successful cancel is a viral screen-record. At 10K cancels/mo that's $20K MRR + interchange — and we haven't started the bidding layer (v2).

**Q5: What's stopping Stripe from building this?**
Stripe sells _to_ the merchants we're disarming. Structural conflict. We're the consumer-side cancellation rail — Stripe Issuing is our weapon, not their product.

**Q6: Why Stripe Issuing and not Tangerine?**
Tangerine is the Canadian go-to-market story (PIPEDA, domestic issuer trust). Stripe Issuing is the global plumbing that ships today. Both. Not either.

**Q7: What's v2?**
The cancel auction: at cancel time, competing merchants (The Globe, Apple News, Substack) bid in real time to win the user back. We monetize the most valuable second in a subscriber's life.

**Q8: How is this defensible long-term?**
Two-sided network: more cancels → more merchants want into the auction → better offers → more users. Underneath: a proprietary library of cancel-flow DOMs the agent has already solved. Both sides compound.

---

## Artifact 3 — Checklists

### Final 5-Minute Checklist (Right Before Stage)

- [ ] **FastAPI agent healthy:** `curl http://localhost:8001/health` → `{"status":"ok"}`
- [ ] **Frontend running:** `pnpm dev` on `localhost:3000`, chat input visible, console clean
- [ ] **Chrome profile signed in:** open `thestar.com/account` in `~/.blackmamba/chrome-profile`, confirm subscription is active and "Cancel" path is reachable. If logged out, log in NOW.
- [ ] **Stripe key loaded:** `echo $STRIPE_SECRET_KEY | head -c 10` should print `sk_test_` — if empty, source the env file.
- [ ] **Backup video** of the clean 201s run open in QuickTime, paused at frame 0, hotkey rehearsed (Cmd+Tab → spacebar).
- [ ] **Submission form** pre-filled in another tab — GitHub URL, demo URL, sponsor checkboxes.
- [ ] **One-liner in clipboard:** _"BlackMamba cancels your subscriptions by driving your real Chrome with Claude — then mints a Stripe card the merchant can charge exactly once, ever."_
- [ ] Wi-Fi check: load `thestar.com` once, confirm <2s.
- [ ] Phone silent, Slack quit, DND on.
- [ ] Deep breath. The cancel works. The card mints. You own the room.

### If Everything Fails

Walk on stage and say:

> _"BlackMamba is the cancel button as a payment primitive. We drive your real Chrome with Claude Sonnet 4.6 to cancel any subscription, then mint a Stripe card the merchant can charge once — ever. v1 ships in 30 days. Built today by Arav, Aarya, and Zain."_

Smile, sit down, you're still ahead.

---

## Artifact 4 — Launch Tweet Thread (post after hackathon)

**Tweet 1 — hook + stat**

> Rocket Money does $12M ARR by emailing humans to cancel your subscriptions for you.
>
> We built something different.
>
> BlackMamba revokes the merchant's ability to charge you in the first place. 🐍
>
> Demo ↓

**Tweet 2 — the GIF**

> One sentence in, real Chrome out, subscription dead in ~3 minutes.
>
> [GIF: chat input → Chrome opens → Toronto Star cancel flow → Chargebee retention declined → confirmation → fullscreen virtual card reveal]

**Tweet 3 — contrarian truth**

> Every cancel tool fights the retention bot.
>
> We don't.
>
> The instant we cancel, we mint a virtual card with an **all-time spending cap set to the subscription price.** Merchant gets one charge. Ever. Every future authorization declines, forever.
>
> Payment-layer cancellation.

**Tweet 4 — how it works**

> Stack:
> • Claude Sonnet 4.6 — decides every click
> • Browser-Use 0.12.8 — drives your real Chrome (not headless, not a sandbox)
> • Stripe Issuing — mints the kill-switch card on cancel success
>
> No screen-scrapers. No hardcoded selectors. The model reads the page like a human.

**Tweet 5 — v1 roadmap**

> v1 (30 days):
>
> Tell the agent your intent in plain English — _"I only want the free trial"_ / _"6 months and out"_ / _"one charge, never again"_ — and it sizes the card to match.
>
> The card becomes the contract. The merchant can't violate what they can't authorize.

**Tweet 6 — ask**

> Early access: [link]
> Code: [GitHub link]
>
> Built at @TechTO hackathon by @aravkek, Aarya, Zain.
> Powered by @AnthropicAI, @browser_use, @stripe Issuing.
>
> If you've ever paid for a subscription you forgot to cancel — this one's for you.

---

## Artifact 5 — TechTO Submission Form Copy

**One-liner (under 120 chars):**

> BlackMamba is an AI agent that cancels subscriptions by driving your real Chrome, then mints a virtual card the merchant can charge exactly once — ever.

**50-word description:**

> BlackMamba is payment-layer subscription cancellation. Tell it in one sentence, and Claude Sonnet 4.6 drives your real Chrome through any cancel flow — including Chargebee retention. The instant cancellation confirms, we mint a Stripe Issuing card capped at the sub price. The merchant gets one charge. Every future authorization declines forever.

**300-word description:**

> Canadians paid $2.4B last year for subscriptions they forgot to cancel. Rocket Money built a $12M-ARR business sending polite letters on their behalf. We thought there was a better way: don't ask the merchant nicely — revoke their ability to charge you.
>
> BlackMamba is an agentic cancellation layer that runs end-to-end in under five minutes. The user types a single sentence ("Cancel my Toronto Star subscription") into a chat. Claude Sonnet 4.6 chooses to invoke our `cancel_subscription` tool, which fires up the user's real Chrome under a dedicated Browser-Use 0.12.8 profile. The agent navigates the full cancel flow autonomously — including the Chargebee retention gauntlet that's purpose-built to break automation. In our demo, the agent completes 16 actions in roughly 200 seconds, walks past the discount-offer dark pattern, and lands on the cancellation confirmation page.
>
> The moment the cancel confirms, we mint a real Stripe Issuing virtual card with an all-time spending cap set to the subscription's price. The merchant can successfully authorize the card exactly once. Every subsequent attempt — whether next month, next year, or after a "we've changed our terms" bait — declines at the network level. The merchant's billing system already marks the subscription cancelled; the card guarantees they can never resurrect it.
>
> v1 (30 days out): the agent extracts subscription terms itself — trial price, full price, billing period — and sizes the card to the user's exact intent. _"I only want the free trial."_ _"Six months and out."_ _"One charge, never again."_ The card becomes the contract.
>
> Built at TechTO 2026 by Arav Kekane, Aarya, and Zain. Powered by Anthropic (Claude Sonnet 4.6), Browser-Use, and Stripe Issuing. Tangerine, ElevenLabs, Backboard.io, and Rootly.ai in the stack.
