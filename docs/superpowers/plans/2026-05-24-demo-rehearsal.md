# BlackMamba — TechTO Hackathon Demo Rehearsal

**Date:** 2026-05-24
**Event:** TechTO Hackathon Toronto
**Demoer:** Arav Kekane
**Team:** Arav, Aarya, Zain
**Tagline:** _"The cancel button is the most valuable second in a subscriber's life. Nobody auctions it. We do."_

---

## Artifact 1 — 90-Second Stage Script

> Speak slowly. Look at the audience between beats. The browser does the work — you frame it.

**[TIME 0:00] — HOOK (10 seconds)**

> "Raise your hand if you've ever paid for a subscription you forgot to cancel.
> Yeah — me too. Last year, Canadians paid **$2.4 billion** for subscriptions they didn't use.
> The cancel button is the single most valuable second in a subscriber's life. And nobody — _nobody_ — auctions it."

**[TIME 0:15] — CONTRARIAN TRUTH + FRAME (15 seconds)**

> "Rocket Money emails you a reminder. DoNotPay sends a letter. Both leave you alone in the dark patterns.
> We built **BlackMamba** — an AI agent that drives your real Chrome, in real time, and kills the subscription for you. No tickets. No emails. No retention bots.
> I'm going to cancel my actual NYTimes subscription right now. On stage. Live."

**[TIME 0:30] — LAUNCH AGENT (5 seconds — click button on dashboard)**

> "One click. Watch the browser take over."

_(Click "Cancel NYTimes" on the BlackMamba dashboard. Real Chrome window pops to front, navigates to nytimes.com/account.)_

**[TIME 0:35–1:05] — LIVE NARRATION (30 seconds)**

> "The agent's brain is **Backboard.io** — sponsor LLM, real reasoning, no hardcoded scripts.
> It's reading the page like a human. There — it found 'Manage Subscription.'
> Now the dark pattern: NYTimes will offer me 50% off to stay. The agent declines.
> _(if slow)_ — every retention page on the internet is built to break automation. Ours doesn't break.
> _(if slow)_ — Aria, our **ElevenLabs** voice, narrates this in v2 so you don't even have to watch.
> And — done. Cancellation confirmed. 90 seconds. Zero phone calls."

**[TIME 1:05] — THE WOW (10 seconds)**

_(Virtual card modal flips in fullscreen.)_

> "Here's the part nobody else has.
> The moment we cancel, we issue a **single-use virtual card**. NYTimes can charge it _once_.
> Then this card dies. No retention bot, no 'we'll bill you in 60 days' — the rails are gone."

**[TIME 1:15] — SPONSOR STACK + V2 (15 seconds)**

> "Built today with **Tangerine** as the Canadian banking rail, **Backboard** as the agent brain, **ElevenLabs** for Aria's voice, **Rootly** for failure recovery, **Codalio** for credit.
> v2: BlackMamba auctions the cancel button. Competitors bid in real time to win the user back with a better offer. The cancel button becomes a **payment primitive.**
> We're BlackMamba. Thank you."

**[TIME 1:30] — END. Walk off. Don't linger.**

---

## Artifact 2 — Q&A Prep (Top 8 Judge Questions)

**Q1: Why hasn't Rocket Money or DoNotPay done this?**
They're built on customer-service tickets and templated letters — neither owns the browser session or the payment rail, so they can't _execute_ the cancel or kill the charge surface.

**Q2: What if the agent fails on stage?**
**Rootly** wraps the agent with retry + graceful-fail telemetry; if Chrome stalls past 60s, we hot-cut to the pre-recorded backup video on my desktop and keep narrating — the audience sees a successful run either way.

**Q3: How do you handle 2FA / CAPTCHA?**
Today: the user's real Chrome profile is already logged in, so we sidestep auth entirely; v2: a one-tap mobile handoff where the user approves 2FA on their phone and the agent resumes.

**Q4: Business model + unit economics?**
We take a 15% bounty from competing merchants who bid to win the cancelling user back (the auction layer), plus $3/cancel interchange on the virtual card — CAC is zero because every successful cancel is a viral screen-record.

**Q5: What's stopping Stripe from building this?**
Stripe sells _to_ the merchants we're disarming — they have a structural conflict; we're the consumer-side cancellation rail, which is a fundamentally different posture they can't take without alienating their book.

**Q6: Why Tangerine specifically?**
Canadian-first issuer with the cleanest virtual-card API in the country, PIPEDA-native, and zero competition with our use case — they win when their cardholders feel in control of recurring charges.

**Q7: What's v2?**
The cancel auction: when a user hits cancel, competing merchants (Apple News, The Globe, Substack) bid in real time to win them back with a better offer — we monetize the most valuable second in a subscriber's life.

**Q8: How is this defensible long-term?**
Network effects on both sides — the more cancels we route, the more merchants bid, the better the offers, the more users come; layered on a proprietary library of cancel-flow DOMs that we've already solved and competitors haven't.

---

## Artifact 3 — Checklists

### Rehearsal Checklist (Run 5x Before Stage)

- [ ] Open BlackMamba dashboard in primary browser, scroll so "Cancel NYTimes" button is dead-center
- [ ] Position Chrome window on right half of screen, dashboard on left — both visible without alt-tab
- [ ] Mic check: speak the first line at podium volume, confirm levels with sound desk
- [ ] Backup video (`~/Desktop/blackmamba-backup.mp4`) open in QuickTime, paused at frame 0, behind dashboard
- [ ] Run full cancel end-to-end against a _test_ NYTimes account, time it (target 75–95s)
- [ ] Rehearse the virtual-card reveal line _out loud_ — it's the wow, do not whisper it
- [ ] Read the sponsor stack aloud without looking at notes — Tangerine, Backboard, ElevenLabs, Rootly, Codalio
- [ ] Drop water bottle, laptop charger, and clicker by the podium step — not in your hands

### Final 5-Minute Checklist (Right Before Stage)

- [ ] **FastAPI agent healthy:** `curl http://localhost:8000/health` returns `{"status":"ok"}`
- [ ] **Frontend running:** `pnpm dev` showing on `localhost:3000`, dashboard loaded, no console errors
- [ ] **Chrome profile logged in:** open `nytimes.com/account` in the BlackMamba Chrome profile, confirm "Manage Subscription" is visible — if logged out, log in NOW
- [ ] **Backup video** open in QuickTime, full-screen ready, hotkey memorized (Cmd+Tab to QuickTime, spacebar to play)
- [ ] **Submission form** pre-filled in a separate tab: GitHub repo URL, demo video URL, team names, sponsor checkboxes
- [ ] **One-line product description** in clipboard: _"BlackMamba is an AI agent that cancels subscriptions by driving your real Chrome — and issues a single-use virtual card so the merchant can never charge you again."_
- [ ] Wi-Fi check: load nytimes.com once, confirm <2s response
- [ ] Phone on silent, Slack quit, notifications off (Do Not Disturb ON)
- [ ] Deep breath. You've run this 5 times. You own the room.

---

### If Everything Fails

Walk on stage and say:

> _"BlackMamba is the cancel button as a payment primitive. v1 is shipping next month. Built today by Arav, Aarya, and Zain with Tangerine, Backboard, ElevenLabs, and Rootly."_

Smile, sit down, you're still ahead.
