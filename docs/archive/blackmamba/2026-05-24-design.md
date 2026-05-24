# BlackMamba — Design

**Date:** 2026-05-24
**Authors:** Aarya, Arav, Zain
**Status:** Draft (brainstorming output, pre-implementation-plan)

## 1. Problem & goal

Users pay for subscriptions they've forgotten about, miss free-trial conversions, and find cancellation flows tedious. BlackMamba ingests a user's Gmail (and optionally uploaded bank statements), detects subscriptions, classifies them by cadence (monthly / annual / trial / one-time / unknown) and necessity (necessary / unnecessary / unknown), and — when the user asks — drives a browser agent to cancel them, with a human in the loop only at genuine decision or block points.

The dev team (Aarya, Arav, Zain) is the first user. The end-user surface is eventually a Chrome extension; v1 ships as a Textual TUI used by the dev team to iterate.

## 2. Scope

**In scope for v1**
- Gmail OAuth + scheduled and on-demand scanning
- Optional CSV bank-statement upload (PDF is a stretch goal)
- LLM-driven structured extraction of subscription events from emails
- Detection / reconciliation of subscriptions across Gmail + statements
- Classification of cadence and necessity, with persistent per-user memory of overrides
- User-triggered cancellation via `browser-use` driven by a shared playbook repo
- Textual TUI front-end for the dev team

**Out of scope for v1**
- Chrome extension (architected for, not built)
- Hosted multi-user backend (user data is local; only playbooks are shared)
- Unattended / scheduled cancellations
- Mobile
- PDF statement parsing (stretch)

## 3. Guiding principles

- **Doer, not chatter.** The agent acts; it only stops to ask the user when a decision is genuinely theirs (CAPTCHA, 2FA, "downgrade vs cancel", retention dark patterns) or when it's blocked.
- **User data local, playbooks shared.** Personal data (tokens, emails, transactions, detected subs) never leaves the user's machine. Cancellation playbooks live in a public GitHub repo and benefit every user as anyone improves them.
- **UI is swappable.** All business logic lives in `blackmamba.core`. The TUI is a thin caller; a future GUI/extension swaps in without core changes.
- **User wins over LLM.** When the user has explicitly labeled something (e.g. "gym is necessary"), the LLM never silently overrides it.

## 4. High-level architecture

```
┌─────────────────────────────────────────────────────────┐
│                      UI Layer (swappable)               │
│         Textual TUI  ←─ same API ─→  Future GUI/Ext     │
└────────────────────────┬────────────────────────────────┘
                         │ in-process calls
┌────────────────────────▼────────────────────────────────┐
│                   blackmamba.core                       │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐                     │
│  │gmail_ingestor│  │stmt_ingestor │  (separate triggers)│
│  └──────┬───────┘  └──────┬───────┘                     │
│         └────────┬────────┘                             │
│                  ▼                                      │
│            ┌──────────┐                                 │
│            │normalize │  → raw_event rows               │
│            └────┬─────┘                                 │
│                 ▼                                       │
│         ┌────────────────┐                              │
│         │detect+reconcile│  → subscription rows         │
│         └────────┬───────┘                              │
│                  ▼                                      │
│            ┌──────────┐                                 │
│            │ classify │  (LLM + persistent user memory) │
│            └────┬─────┘                                 │
│                 ▼                                       │
│            ┌──────────┐                                 │
│            │  store   │  (SQLite + OS keychain)         │
│            └────┬─────┘                                 │
│                 ▼                                       │
│         ┌─────────────────┐                             │
│         │unsubscribe agent│  (user-triggered per sub)   │
│         └─────────────────┘                             │
└────────────────┬─────────────────────┬──────────────────┘
                 │                     │
        ┌────────▼──────┐     ┌────────▼─────────┐
        │  External     │     │  External        │
        │  - Gmail API  │     │  - backboard.io  │
        │  - CSV upload │     │  - browser-use   │
        │               │     │  - Playbook repo │
        └───────────────┘     └──────────────────┘
```

**Layering rule:** `blackmamba.core` has zero UI imports. Stages are typed functions (sync or async) over typed inputs.

## 5. Components

| Component | Trigger | Responsibility |
|-----------|---------|----------------|
| `gmail_ingestor` | Scheduled (daily) + on-demand | OAuth, full backfill (2y) on first run, incremental via Gmail History API afterward, cheap sender/keyword prefilter |
| `stmt_ingestor` | User upload (ad-hoc) | Parse CSV (PDF stretch), map columns, emit normalized charge events |
| `normalize` | Per ingested message/row | LLM structured extraction via backboard into a common event schema; validate with pydantic; persist raw + parsed |
| `detect & reconcile` | After ingest | Group events by (merchant, amount); cross-reference Gmail signups against bank charges; surface trials (Gmail signup + no charge, or $0.01/$1 verify charges); promote to `subscription` rows |
| `classify` | After detect | Look up matching `user_preference` first; for unmatched, call backboard with the user's memory thread for context; write necessity + source + confidence |
| `store` | All stages | SQLite for data, `keyring` (OS keychain) for credentials and OAuth tokens |
| `unsubscribe agent` | User picks a sub | Pull latest playbooks (git pull), look up by merchant + region, drive `browser-use` against user's real Chrome profile (default) with transcript + screenshots |

## 6. Data model (SQLite, local)

```
raw_event(id, source, external_id, received_at, raw_blob, parsed,
          kind, subscription_id)
subscription(id, merchant, canonical_name, cadence, amount, currency,
             next_charge_at, trial_ends_at, status, necessity,
             necessity_source, confidence, first_seen_at, last_seen_at,
             cancel_url)
user_preference(key, necessity_default, updated_at, reason)
cancel_attempt(id, subscription_id, started_at, ended_at, outcome,
               playbook_id, playbook_version, transcript, screenshots[])
  -- outcome ∈ {success, failed, needs_human, manual, aborted}
playbook(id, merchant, canonical_name, cancel_url, region, language,
         steps, selectors, requires_2fa, requires_phone,
         estimated_minutes, source, author, created_at, updated_at,
         version, upstream_url)
playbook_run(id, playbook_id, playbook_version, cancel_attempt_id,
             succeeded, failure_step, failure_reason, duration_ms,
             ran_at, client_version, contributed_back)
```

**Notes:**
- `raw_event` retains the original payload so we can re-parse later when detection improves, without re-fetching from Gmail.
- `necessity_source` distinguishes LLM labels (re-runnable) from user overrides (sticky).
- `playbook` rows are a local cache of the public `blackmamba-playbooks` GitHub repo.
- `playbook_run` is local telemetry; with user consent, anonymized rows can be contributed back to surface "Prime US is broken since Tuesday" patterns.

## 7. Data flows

### Journey A — "Scan my Gmail" (scheduled or on-demand)

1. Trigger fires (cron or user click).
2. `gmail_ingestor` syncs new messages via History API (or full 2y backfill on first run); cheap prefilter on sender/subject narrows the set.
3. `normalize` runs LLM structured extraction (via backboard) over filtered messages; persists `raw_event` rows with parsed `{kind, merchant, amount, currency, cadence_hint, is_trial, trial_end_date, next_charge_date}`.
4. `detect & reconcile` groups events into subscription candidates and cross-checks against any bank charges, including small-verify-charge signals for trials.
5. `classify` consults `user_preference`, then calls backboard for unmatched cases with the user's memory thread for context.
6. UI is notified ("3 new subs detected, 1 trial ends in 4 days").

### Journey B — "Unsubscribe me from X"

1. User picks a subscription in the UI.
2. `unsubscribe` pulls latest playbooks (`git pull`), looks up by merchant + region.
3. Path branches on playbook richness:
   - No playbook → `browser-use` with `cancel_url` and goal only.
   - Plaintext-only → `browser-use` using the steps as the agent's goal script.
   - Plaintext + selector hints → `browser-use` prefers selectors, falls back to LLM vision when selectors break.
4. Browser launch: default is user's real Chrome profile (cookies/2FA intact). User can override per run: fresh browser + manual login, or fresh browser + creds from OS keychain (opt-in).
5. Agent runs, recording full transcript + screenshots. Auto-confirms benign decision points ("are you sure?"); pauses for user at real decisions (downgrade vs cancel) or blockers (CAPTCHA, 2FA, phone-only).
6. Verify outcome via confirmation page heuristic + later confirmation email. If unverifiable → `outcome = needs_human`.
7. Record `cancel_attempt` + `playbook_run`. With consent, contribute anonymized run telemetry upstream.

## 8. External dependencies

- **backboard.io** (`docs.backboard.io`) — LLM gateway + persistent memory + RAG via HTTP REST (`X-API-Key`). Used in three concentrated places: structured extraction in `normalize`, classification with per-user memory in `classify`, and (later) RAG over playbook descriptions. Wrapped behind a thin internal client so the dependency is swappable.
- **Gmail API** — `google-api-python-client`, OAuth tokens stored in OS keychain.
- **browser-use** — LLM-driven browser automation (Playwright underneath). Chosen over Stagehand for Python-native fit.
- **`blackmamba-playbooks`** — separate public GitHub repo, YAML playbooks, PR-reviewed. Pulled on demand by the client.
- **`keyring`** — OS keychain access (macOS Keychain / Windows Credential Manager / libsecret).

## 9. Error handling & failure modes

**Gmail ingest** — token revoked → re-prompt OAuth; rate limit → backoff + cursor; malformed message → keep raw, mark `parsed = null`.

**Statement ingest** — unknown CSV → user maps columns once, mapping saved per bank; PDF failure → fall back to paste-text.

**Normalize** — backboard 5xx → retry + backoff, then `parsed = null` (re-runnable from raw); pydantic validation fail → one strict-prompt retry, then drop extraction (keep raw).

**Detect & reconcile** — same merchant under multiple names → canonicalization table grown by user merges; duplicates avoided by `(source, external_id)` idempotency.

**Classify** — user override always wins over LLM; low confidence → `necessity = unknown` (never guess).

**Unsubscribe agent**
- Playbook step fails → screenshot, one LLM vision-based recovery attempt, then `needs_human`.
- Login wall → pause for user, resume after they sign in in the live browser.
- 2FA / CAPTCHA / phone-only → `outcome = needs_human` with clear next steps (this is a *correct* outcome of the agent, not a failure).
- Retention dark patterns ("pause" disguised as "cancel") → after claimed success, LLM re-reads confirmation text; ambiguity → flag for user to verify the confirmation email.
- Browser hang / Playwright crash → 5min per-step timeout, state captured.

**Shared playbook repo** — network/git fail → use local cache, log staleness. Playbooks are PR-reviewed; `browser-use` is scoped to the merchant domain; all actions logged; user can watch live.

**Cross-cutting** — every cancellation is logged with full transcript; no silent deletion (`status = canceled` keeps the row); user can stop a run at any time.

The failure-mode list is expected to grow from `playbook_run.failure_reason` telemetry once real runs are happening.

## 10. Testing strategy

- **Pure logic** (`normalize` parser, `detect`, canonicalization, idempotency): unit tests on fixtures, <5s, no network.
- **LLM-dependent stages**: recorded-fixture replay (record real backboard responses once against the dev team's emails, commit, replay). Re-record intentionally on prompt changes.
- **Gmail / external HTTP**: `vcr.py` / `responses` mocks in CI; one real end-to-end run gated behind env var, run locally before releases.
- **Browser automation**: unit-test the playbook parser and orchestrator state machine against fake `browser-use` clients. Maintain a small selector smoke-test harness that runs against captured HTML snapshots of cancellation pages. Real browser runs only against dev-owned test accounts, gated behind env var, run manually.
- **Shared playbook repo**: schema lint in the repo's own CI; required fields enforced at PR time.
- **Dogfood**: the dev team's Gmail is the truest test set. Every release: scan all three inboxes, eyeball results, file issues.

Explicitly out of scope for v1 CI: end-to-end runs against real subscription sites (too flaky, too costly), coverage targets on glue code.

## 11. Open questions to revisit during planning

- Exact backboard prompt and JSON schema for `normalize` extraction (will iterate against real emails).
- Canonical-name table seeding strategy (start empty, grow from corrections vs ship with a small seed).
- Where the playbook repo lives (org repo vs personal) and contribution license.
- Telemetry contribution-back mechanism (lightweight stats endpoint vs PR-based vs none in v1).
