# BlackMamba — Plan 1: Vertical Slice (Gmail → Subscriptions in TUI)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** End-to-end vertical slice: a dev runs the TUI, authenticates Gmail once, scans their inbox, and sees detected subscriptions classified by cadence and necessity. No unsubscribe, no statement ingest — those are Plans 2 and 3.

**Architecture:** Python package `blackmamba` with a `core` subpackage (pure logic, zero UI imports) and a `tui` subpackage (Textual app calling into core). Pipeline stages — `gmail_ingestor → normalize → detect → classify → store` — are typed functions that read/write a local SQLite database via SQLModel. LLM extraction and classification go through a thin `backboard` client wrapping their REST API.

**Tech Stack:** Python 3.12, `uv` (env + deps), `pytest`, `SQLModel` (pydantic + SQLAlchemy), `google-api-python-client` (Gmail), `httpx` (backboard REST), `keyring` (OS keychain for OAuth tokens), `Textual` (TUI).

---

## File Structure

```
blackmamba/
  pyproject.toml
  README.md
  .env.example
  .gitignore
  src/blackmamba/
    __init__.py
    core/
      __init__.py
      schemas.py            # pydantic models (events, extraction, classify)
      models.py             # SQLModel tables (raw_event, subscription, user_preference)
      db.py                 # SQLite engine, session, init
      backboard.py          # httpx client for backboard.io REST
      gmail/
        __init__.py
        auth.py             # OAuth flow, token storage via keyring
        client.py           # gmail API wrapper, list/get messages
        prefilter.py        # cheap sender/subject filter
        ingestor.py         # orchestrates fetch → persist raw_event
      normalize.py          # LLM extraction → parsed event
      detect.py             # group events → subscription candidates
      classify.py           # LLM + user_preference → necessity
      pipeline.py           # glue: scan() runs the full pipeline
    tui/
      __init__.py
      app.py                # Textual App
      screens/
        __init__.py
        subscriptions.py    # list + filter view
        auth.py             # OAuth setup screen
  tests/
    __init__.py
    conftest.py             # shared fixtures: tmp db, fake backboard, fake gmail
    fixtures/
      emails/               # raw gmail message JSONs (real captures, redacted)
      backboard/            # recorded backboard responses
    test_schemas.py
    test_db.py
    test_backboard.py
    test_gmail_prefilter.py
    test_gmail_ingestor.py
    test_normalize.py
    test_detect.py
    test_classify.py
    test_pipeline.py
```

---

## Task 1: Project scaffold

**Files:**
- Create: `pyproject.toml`, `.gitignore`, `.env.example`, `src/blackmamba/__init__.py`, `tests/__init__.py`, `tests/conftest.py`

- [ ] **Step 1: Create `pyproject.toml`**

```toml
[project]
name = "blackmamba"
version = "0.1.0"
description = "Find and cancel subscriptions automatically"
requires-python = ">=3.12"
dependencies = [
    "sqlmodel>=0.0.16",
    "httpx>=0.27",
    "pydantic>=2.7",
    "google-api-python-client>=2.130",
    "google-auth-oauthlib>=1.2",
    "keyring>=25",
    "textual>=0.70",
    "python-dotenv>=1.0",
]

[project.optional-dependencies]
dev = ["pytest>=8", "pytest-asyncio>=0.23", "respx>=0.21", "ruff>=0.4"]

[project.scripts]
blackmamba = "blackmamba.tui.app:main"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/blackmamba"]

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
```

- [ ] **Step 2: Create `.gitignore`**

```
.venv/
__pycache__/
*.pyc
.pytest_cache/
.env
*.db
*.sqlite
.DS_Store
dist/
build/
*.egg-info/
```

- [ ] **Step 3: Create `.env.example`**

```
BACKBOARD_API_KEY=
BACKBOARD_BASE_URL=https://api.backboard.io
BLACKMAMBA_DB_PATH=~/.blackmamba/blackmamba.db
GMAIL_OAUTH_CLIENT_PATH=~/.blackmamba/gmail_client_secret.json
```

- [ ] **Step 4: Create empty package init files**

```python
# src/blackmamba/__init__.py
__version__ = "0.1.0"
```

```python
# tests/__init__.py
```

```python
# tests/conftest.py
```

- [ ] **Step 5: Create venv and install**

Run: `uv venv && uv pip install -e ".[dev]"`
Expected: venv created, packages install with no error.

- [ ] **Step 6: Verify pytest discovers no tests yet**

Run: `uv run pytest -q`
Expected: `no tests ran`.

- [ ] **Step 7: Commit**

```bash
git add pyproject.toml .gitignore .env.example src/ tests/
git commit -m "chore: project scaffold (uv, pytest, sqlmodel, textual)"
```

---

## Task 2: Core pydantic schemas

**Files:**
- Create: `src/blackmamba/core/__init__.py`, `src/blackmamba/core/schemas.py`
- Test: `tests/test_schemas.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_schemas.py
from datetime import datetime
import pytest
from pydantic import ValidationError
from blackmamba.core.schemas import (
    EventKind, Cadence, Necessity,
    ExtractedEvent, ClassificationResult,
)

def test_extracted_event_minimal():
    e = ExtractedEvent(kind=EventKind.signup, merchant="Netflix")
    assert e.kind == EventKind.signup
    assert e.merchant == "Netflix"
    assert e.amount is None
    assert e.is_trial is False

def test_extracted_event_full():
    e = ExtractedEvent(
        kind=EventKind.charge,
        merchant="Spotify",
        amount=9.99,
        currency="USD",
        cadence_hint=Cadence.monthly,
        is_trial=False,
        next_charge_date=datetime(2026, 6, 1),
    )
    assert e.amount == 9.99
    assert e.cadence_hint == Cadence.monthly

def test_extracted_event_rejects_negative_amount():
    with pytest.raises(ValidationError):
        ExtractedEvent(kind=EventKind.charge, merchant="X", amount=-1.0)

def test_classification_result():
    c = ClassificationResult(
        necessity=Necessity.unnecessary,
        confidence=0.8,
        reason="Streaming entertainment, duplicate of Hulu.",
    )
    assert c.necessity == Necessity.unnecessary
    assert 0 <= c.confidence <= 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_schemas.py -v`
Expected: ImportError on `blackmamba.core.schemas`.

- [ ] **Step 3: Create `__init__.py` and `schemas.py`**

```python
# src/blackmamba/core/__init__.py
```

```python
# src/blackmamba/core/schemas.py
from datetime import datetime
from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field, ConfigDict

class EventKind(str, Enum):
    signup = "signup"
    charge = "charge"
    renewal = "renewal"
    trial_end = "trial_end"
    receipt = "receipt"
    cancellation = "cancellation"
    other = "other"

class Cadence(str, Enum):
    monthly = "monthly"
    annual = "annual"
    trial = "trial"
    one_time = "one_time"
    unknown = "unknown"

class Necessity(str, Enum):
    necessary = "necessary"
    unnecessary = "unnecessary"
    unknown = "unknown"

class ExtractedEvent(BaseModel):
    model_config = ConfigDict(extra="ignore")
    kind: EventKind
    merchant: str = Field(min_length=1)
    amount: Optional[float] = Field(default=None, ge=0)
    currency: Optional[str] = None
    cadence_hint: Cadence = Cadence.unknown
    is_trial: bool = False
    trial_end_date: Optional[datetime] = None
    next_charge_date: Optional[datetime] = None
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)

class ClassificationResult(BaseModel):
    necessity: Necessity
    confidence: float = Field(ge=0.0, le=1.0)
    reason: str
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_schemas.py -v`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blackmamba/core/__init__.py src/blackmamba/core/schemas.py tests/test_schemas.py
git commit -m "feat(core): pydantic schemas for events and classification"
```

---

## Task 3: SQLModel tables + DB module

**Files:**
- Create: `src/blackmamba/core/models.py`, `src/blackmamba/core/db.py`
- Test: `tests/test_db.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_db.py
from datetime import datetime
from sqlmodel import Session, select
from blackmamba.core.db import init_db, get_engine
from blackmamba.core.models import RawEvent, Subscription, UserPreference

def test_init_db_creates_tables(tmp_path):
    db = tmp_path / "t.db"
    engine = get_engine(str(db))
    init_db(engine)
    with Session(engine) as s:
        s.add(RawEvent(
            source="gmail", external_id="m1",
            received_at=datetime(2026, 1, 1),
            raw_blob='{"x":1}', kind="signup",
        ))
        s.commit()
        rows = s.exec(select(RawEvent)).all()
        assert len(rows) == 1
        assert rows[0].external_id == "m1"

def test_raw_event_unique_per_source(tmp_path):
    from sqlalchemy.exc import IntegrityError
    db = tmp_path / "t.db"
    engine = get_engine(str(db))
    init_db(engine)
    with Session(engine) as s:
        s.add(RawEvent(source="gmail", external_id="m1",
                       received_at=datetime.now(), raw_blob="{}", kind="signup"))
        s.commit()
    with Session(engine) as s:
        s.add(RawEvent(source="gmail", external_id="m1",
                       received_at=datetime.now(), raw_blob="{}", kind="signup"))
        try:
            s.commit()
            raise AssertionError("expected IntegrityError")
        except IntegrityError:
            pass

def test_subscription_roundtrip(tmp_path):
    db = tmp_path / "t.db"
    engine = get_engine(str(db))
    init_db(engine)
    with Session(engine) as s:
        sub = Subscription(merchant="Netflix", canonical_name="netflix",
                           cadence="monthly", amount=15.99, currency="USD",
                           status="active", necessity="unnecessary",
                           necessity_source="llm", confidence=0.7,
                           first_seen_at=datetime.now(), last_seen_at=datetime.now())
        s.add(sub); s.commit(); s.refresh(sub)
        assert sub.id is not None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_db.py -v`
Expected: ImportError.

- [ ] **Step 3: Create `models.py`**

```python
# src/blackmamba/core/models.py
from datetime import datetime
from typing import Optional
from sqlmodel import SQLModel, Field, UniqueConstraint

class RawEvent(SQLModel, table=True):
    __tablename__ = "raw_event"
    __table_args__ = (UniqueConstraint("source", "external_id"),)
    id: Optional[int] = Field(default=None, primary_key=True)
    source: str
    external_id: str
    received_at: datetime
    raw_blob: str
    parsed: Optional[str] = None
    kind: Optional[str] = None
    subscription_id: Optional[int] = Field(default=None, foreign_key="subscription.id")

class Subscription(SQLModel, table=True):
    __tablename__ = "subscription"
    id: Optional[int] = Field(default=None, primary_key=True)
    merchant: str
    canonical_name: str = Field(index=True)
    cadence: str
    amount: Optional[float] = None
    currency: Optional[str] = None
    next_charge_at: Optional[datetime] = None
    trial_ends_at: Optional[datetime] = None
    status: str = "active"
    necessity: str = "unknown"
    necessity_source: str = "llm"
    confidence: float = 0.0
    first_seen_at: datetime
    last_seen_at: datetime
    cancel_url: Optional[str] = None

class UserPreference(SQLModel, table=True):
    __tablename__ = "user_preference"
    id: Optional[int] = Field(default=None, primary_key=True)
    key: str = Field(unique=True, index=True)
    necessity_default: str
    updated_at: datetime
    reason: Optional[str] = None
```

- [ ] **Step 4: Create `db.py`**

```python
# src/blackmamba/core/db.py
from pathlib import Path
from sqlmodel import SQLModel, create_engine
from sqlalchemy.engine import Engine
from . import models  # noqa: F401  (register tables)

def get_engine(db_path: str) -> Engine:
    p = Path(db_path).expanduser()
    p.parent.mkdir(parents=True, exist_ok=True)
    return create_engine(f"sqlite:///{p}", echo=False)

def init_db(engine: Engine) -> None:
    SQLModel.metadata.create_all(engine)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest tests/test_db.py -v`
Expected: 3 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/blackmamba/core/models.py src/blackmamba/core/db.py tests/test_db.py
git commit -m "feat(core): SQLModel tables (raw_event, subscription, user_preference)"
```

---

## Task 4: Backboard client (thin httpx wrapper)

**Files:**
- Create: `src/blackmamba/core/backboard.py`
- Test: `tests/test_backboard.py`

The backboard API: `POST /threads/messages` with `X-API-Key` header; body sends a message and returns the model's response.

- [ ] **Step 1: Write failing tests**

```python
# tests/test_backboard.py
import pytest
import respx
import httpx
from blackmamba.core.backboard import BackboardClient

@pytest.mark.asyncio
@respx.mock
async def test_send_message_includes_api_key():
    route = respx.post("https://api.backboard.io/threads/messages").mock(
        return_value=httpx.Response(200, json={"response": "hello"})
    )
    client = BackboardClient(api_key="k", base_url="https://api.backboard.io")
    out = await client.send_message(assistant_id="a1", content="hi")
    assert out == {"response": "hello"}
    assert route.calls.last.request.headers["X-API-Key"] == "k"

@pytest.mark.asyncio
@respx.mock
async def test_send_message_passes_thread_id():
    respx.post("https://api.backboard.io/threads/messages").mock(
        return_value=httpx.Response(200, json={"response": "x", "thread_id": "t1"})
    )
    client = BackboardClient(api_key="k", base_url="https://api.backboard.io")
    out = await client.send_message(assistant_id="a1", content="hi", thread_id="t1")
    assert out["thread_id"] == "t1"

@pytest.mark.asyncio
@respx.mock
async def test_send_message_retries_on_5xx():
    respx.post("https://api.backboard.io/threads/messages").mock(
        side_effect=[
            httpx.Response(503),
            httpx.Response(200, json={"response": "ok"}),
        ]
    )
    client = BackboardClient(api_key="k", base_url="https://api.backboard.io",
                             max_retries=2, retry_base_delay=0)
    out = await client.send_message(assistant_id="a1", content="hi")
    assert out == {"response": "ok"}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_backboard.py -v`
Expected: ImportError.

- [ ] **Step 3: Create `backboard.py`**

```python
# src/blackmamba/core/backboard.py
import asyncio
from typing import Optional
import httpx

class BackboardError(RuntimeError):
    pass

class BackboardClient:
    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.backboard.io",
        timeout: float = 30.0,
        max_retries: int = 3,
        retry_base_delay: float = 0.5,
    ):
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._max_retries = max_retries
        self._retry_base_delay = retry_base_delay

    async def send_message(
        self,
        assistant_id: str,
        content: str,
        thread_id: Optional[str] = None,
    ) -> dict:
        body = {"assistant_id": assistant_id, "content": content}
        if thread_id:
            body["thread_id"] = thread_id
        headers = {"X-API-Key": self._api_key, "Content-Type": "application/json"}
        url = f"{self._base_url}/threads/messages"
        async with httpx.AsyncClient(timeout=self._timeout) as c:
            for attempt in range(self._max_retries):
                resp = await c.post(url, json=body, headers=headers)
                if resp.status_code < 500:
                    if resp.status_code >= 400:
                        raise BackboardError(f"{resp.status_code}: {resp.text}")
                    return resp.json()
                await asyncio.sleep(self._retry_base_delay * (2 ** attempt))
        raise BackboardError(f"giving up after {self._max_retries} retries")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_backboard.py -v`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blackmamba/core/backboard.py tests/test_backboard.py
git commit -m "feat(core): backboard.io HTTP client with retry"
```

---

## Task 5: Gmail prefilter (pure function)

**Files:**
- Create: `src/blackmamba/core/gmail/__init__.py`, `src/blackmamba/core/gmail/prefilter.py`
- Test: `tests/test_gmail_prefilter.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_gmail_prefilter.py
from blackmamba.core.gmail.prefilter import looks_subscription_related

def test_billing_subject_matches():
    assert looks_subscription_related(
        sender="noreply@spotify.com",
        subject="Your monthly receipt",
        snippet="Thanks for being a Spotify Premium subscriber.",
    )

def test_known_sender_matches_even_with_neutral_subject():
    assert looks_subscription_related(
        sender="receipts@netflix.com",
        subject="Hi",
        snippet="",
    )

def test_unrelated_does_not_match():
    assert not looks_subscription_related(
        sender="mom@example.com",
        subject="Lunch tomorrow?",
        snippet="",
    )

def test_trial_signup_matches():
    assert looks_subscription_related(
        sender="hello@example.com",
        subject="Welcome to your 7-day free trial",
        snippet="",
    )

def test_unsubscribe_link_alone_does_not_match():
    # Newsletter footers always contain 'unsubscribe' — must not trigger.
    assert not looks_subscription_related(
        sender="newsletter@anything.com",
        subject="This week's news",
        snippet="Click here to unsubscribe.",
    )
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_gmail_prefilter.py -v`
Expected: ImportError.

- [ ] **Step 3: Create the module**

```python
# src/blackmamba/core/gmail/__init__.py
```

```python
# src/blackmamba/core/gmail/prefilter.py
import re

SUBJECT_KEYWORDS = [
    r"\breceipt\b", r"\binvoice\b", r"\bsubscription\b", r"\brenewal\b",
    r"\bbilling\b", r"\bpayment\b", r"\bfree trial\b", r"\btrial\b",
    r"\bwelcome to\b", r"\bauto[- ]?renew", r"\bmembership\b",
    r"\bcharged\b", r"\bplan\b",
]
SUBJECT_RE = re.compile("|".join(SUBJECT_KEYWORDS), re.I)

KNOWN_BILLING_SENDERS = {
    "receipts@netflix.com", "noreply@spotify.com", "billing@github.com",
    "no-reply@accounts.google.com", "billing@anthropic.com",
    "noreply@openai.com", "support@apple.com", "no_reply@email.apple.com",
}

KNOWN_BILLING_DOMAINS = {
    "stripe.com", "paddle.com", "chargebee.com", "recurly.com",
}

def _extract_domain(sender: str) -> str:
    m = re.search(r"@([^>\s]+)", sender)
    return (m.group(1).lower() if m else "").strip()

def looks_subscription_related(sender: str, subject: str, snippet: str) -> bool:
    sender_lc = sender.lower()
    if sender_lc in KNOWN_BILLING_SENDERS:
        return True
    domain = _extract_domain(sender_lc)
    if domain in KNOWN_BILLING_DOMAINS:
        return True
    if SUBJECT_RE.search(subject or ""):
        return True
    return False
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_gmail_prefilter.py -v`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blackmamba/core/gmail/__init__.py src/blackmamba/core/gmail/prefilter.py tests/test_gmail_prefilter.py
git commit -m "feat(gmail): cheap subscription-related prefilter"
```

---

## Task 6: Gmail OAuth + token storage

**Files:**
- Create: `src/blackmamba/core/gmail/auth.py`
- Test: `tests/test_gmail_auth.py`

This task wraps Google's `InstalledAppFlow`. Test by mocking; manual end-to-end auth is documented in the README later.

- [ ] **Step 1: Write failing tests**

```python
# tests/test_gmail_auth.py
from unittest.mock import MagicMock, patch
from blackmamba.core.gmail.auth import load_credentials, save_credentials

KEYRING_SERVICE = "blackmamba"
KEYRING_USER = "gmail_oauth_token"

def test_save_and_load_credentials_round_trip():
    creds = MagicMock()
    creds.to_json.return_value = '{"token":"abc"}'
    with patch("blackmamba.core.gmail.auth.keyring") as kr:
        save_credentials(creds)
        kr.set_password.assert_called_once_with(KEYRING_SERVICE, KEYRING_USER, '{"token":"abc"}')

def test_load_credentials_returns_none_when_absent():
    with patch("blackmamba.core.gmail.auth.keyring") as kr:
        kr.get_password.return_value = None
        assert load_credentials() is None

def test_load_credentials_parses_stored_json():
    fake_creds = object()
    with patch("blackmamba.core.gmail.auth.keyring") as kr, \
         patch("blackmamba.core.gmail.auth.Credentials") as Creds:
        kr.get_password.return_value = '{"token":"abc"}'
        Creds.from_authorized_user_info.return_value = fake_creds
        assert load_credentials() is fake_creds
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_gmail_auth.py -v`
Expected: ImportError.

- [ ] **Step 3: Create `auth.py`**

```python
# src/blackmamba/core/gmail/auth.py
import json
from pathlib import Path
from typing import Optional
import keyring
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request

KEYRING_SERVICE = "blackmamba"
KEYRING_USER = "gmail_oauth_token"
SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

def save_credentials(creds: Credentials) -> None:
    keyring.set_password(KEYRING_SERVICE, KEYRING_USER, creds.to_json())

def load_credentials() -> Optional[Credentials]:
    blob = keyring.get_password(KEYRING_SERVICE, KEYRING_USER)
    if not blob:
        return None
    info = json.loads(blob)
    return Credentials.from_authorized_user_info(info, SCOPES)

def run_oauth_flow(client_secret_path: str) -> Credentials:
    flow = InstalledAppFlow.from_client_secrets_file(client_secret_path, SCOPES)
    creds = flow.run_local_server(port=0)
    save_credentials(creds)
    return creds

def ensure_credentials(client_secret_path: str) -> Credentials:
    creds = load_credentials()
    if creds and creds.valid:
        return creds
    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
        save_credentials(creds)
        return creds
    if not Path(client_secret_path).expanduser().exists():
        raise FileNotFoundError(
            f"Gmail OAuth client secret not found at {client_secret_path}. "
            "Create one at https://console.cloud.google.com/apis/credentials "
            "(Desktop app), enable the Gmail API, and download client_secret.json."
        )
    return run_oauth_flow(str(Path(client_secret_path).expanduser()))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_gmail_auth.py -v`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blackmamba/core/gmail/auth.py tests/test_gmail_auth.py
git commit -m "feat(gmail): OAuth flow with keyring token storage"
```

---

## Task 7: Gmail client + ingestor

**Files:**
- Create: `src/blackmamba/core/gmail/client.py`, `src/blackmamba/core/gmail/ingestor.py`
- Test: `tests/test_gmail_ingestor.py`, `tests/fixtures/emails/spotify_receipt.json`

- [ ] **Step 1: Add a fixture email**

```json
// tests/fixtures/emails/spotify_receipt.json
{
  "id": "m-spotify-1",
  "internalDate": "1735689600000",
  "payload": {
    "headers": [
      {"name": "From", "value": "Spotify <noreply@spotify.com>"},
      {"name": "Subject", "value": "Your Spotify Premium receipt"},
      {"name": "Date", "value": "Tue, 1 Jan 2026 00:00:00 +0000"}
    ],
    "body": {"data": ""},
    "parts": [
      {"mimeType": "text/plain", "body": {"data": "VGhhbmtzIGZvciBiZWluZyBhIFNwb3RpZnkgUHJlbWl1bSBzdWJzY3JpYmVyLiBZb3UgcGFpZCAkOS45OS4="}}
    ]
  },
  "snippet": "Thanks for being a Spotify Premium subscriber. You paid $9.99."
}
```

- [ ] **Step 2: Write failing tests**

```python
# tests/test_gmail_ingestor.py
import json
from pathlib import Path
from sqlmodel import Session, select
from blackmamba.core.db import get_engine, init_db
from blackmamba.core.models import RawEvent
from blackmamba.core.gmail.ingestor import ingest_messages
from blackmamba.core.gmail.client import GmailMessage

FIXTURES = Path(__file__).parent / "fixtures" / "emails"

class FakeGmail:
    def __init__(self, messages):
        self._messages = messages
    def list_message_ids(self, query=None, max_results=None):
        return [m["id"] for m in self._messages]
    def get_message(self, mid):
        m = next(m for m in self._messages if m["id"] == mid)
        return GmailMessage.from_api_payload(m)

def _load(name):
    return json.loads((FIXTURES / name).read_text())

def test_ingest_persists_filtered_messages(tmp_path):
    engine = get_engine(str(tmp_path / "t.db")); init_db(engine)
    fake = FakeGmail([_load("spotify_receipt.json")])
    n = ingest_messages(fake, engine)
    assert n == 1
    with Session(engine) as s:
        rows = s.exec(select(RawEvent)).all()
        assert len(rows) == 1
        assert rows[0].source == "gmail"
        assert rows[0].external_id == "m-spotify-1"

def test_ingest_is_idempotent(tmp_path):
    engine = get_engine(str(tmp_path / "t.db")); init_db(engine)
    fake = FakeGmail([_load("spotify_receipt.json")])
    ingest_messages(fake, engine)
    n2 = ingest_messages(fake, engine)
    assert n2 == 0
    with Session(engine) as s:
        assert len(s.exec(select(RawEvent)).all()) == 1
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `uv run pytest tests/test_gmail_ingestor.py -v`
Expected: ImportError.

- [ ] **Step 4: Create `client.py`**

```python
# src/blackmamba/core/gmail/client.py
import base64
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable, Optional
from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials

@dataclass
class GmailMessage:
    id: str
    received_at: datetime
    sender: str
    subject: str
    snippet: str
    body_text: str
    raw_payload: dict

    @classmethod
    def from_api_payload(cls, payload: dict) -> "GmailMessage":
        headers = {h["name"].lower(): h["value"] for h in payload.get("payload", {}).get("headers", [])}
        ts_ms = int(payload.get("internalDate", "0"))
        received = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc)
        body = ""
        parts = payload.get("payload", {}).get("parts") or []
        for p in parts:
            if p.get("mimeType") == "text/plain":
                data = p.get("body", {}).get("data", "")
                if data:
                    body = base64.urlsafe_b64decode(data + "===").decode("utf-8", errors="replace")
                    break
        if not body:
            data = payload.get("payload", {}).get("body", {}).get("data", "")
            if data:
                body = base64.urlsafe_b64decode(data + "===").decode("utf-8", errors="replace")
        return cls(
            id=payload["id"],
            received_at=received,
            sender=headers.get("from", ""),
            subject=headers.get("subject", ""),
            snippet=payload.get("snippet", ""),
            body_text=body,
            raw_payload=payload,
        )

class GmailAPI:
    def __init__(self, creds: Credentials):
        self._svc = build("gmail", "v1", credentials=creds, cache_discovery=False)

    def list_message_ids(self, query: Optional[str] = None, max_results: int = 500) -> list[str]:
        ids: list[str] = []
        page_token = None
        while True:
            resp = self._svc.users().messages().list(
                userId="me", q=query, maxResults=min(500, max_results - len(ids)),
                pageToken=page_token,
            ).execute()
            ids.extend(m["id"] for m in resp.get("messages", []))
            page_token = resp.get("nextPageToken")
            if not page_token or len(ids) >= max_results:
                break
        return ids

    def get_message(self, message_id: str) -> GmailMessage:
        payload = self._svc.users().messages().get(
            userId="me", id=message_id, format="full"
        ).execute()
        return GmailMessage.from_api_payload(payload)
```

- [ ] **Step 5: Create `ingestor.py`**

```python
# src/blackmamba/core/gmail/ingestor.py
import json
from typing import Protocol
from sqlmodel import Session, select
from sqlalchemy.engine import Engine
from ..models import RawEvent
from .client import GmailMessage
from .prefilter import looks_subscription_related

class GmailLike(Protocol):
    def list_message_ids(self, query=None, max_results=None) -> list[str]: ...
    def get_message(self, message_id: str) -> GmailMessage: ...

DEFAULT_QUERY = (
    "newer_than:2y AND ("
    "subject:(receipt OR invoice OR subscription OR renewal OR billing OR trial OR welcome) "
    "OR from:(stripe.com OR paddle.com OR netflix.com OR spotify.com))"
)

def ingest_messages(
    gmail: GmailLike, engine: Engine, query: str = DEFAULT_QUERY, max_results: int = 1000
) -> int:
    ids = gmail.list_message_ids(query=query, max_results=max_results)
    inserted = 0
    with Session(engine) as s:
        existing = {r for r, in s.exec(select(RawEvent.external_id).where(RawEvent.source == "gmail"))}
        for mid in ids:
            if mid in existing:
                continue
            msg = gmail.get_message(mid)
            if not looks_subscription_related(msg.sender, msg.subject, msg.snippet):
                continue
            s.add(RawEvent(
                source="gmail", external_id=msg.id, received_at=msg.received_at,
                raw_blob=json.dumps(msg.raw_payload), kind=None,
            ))
            inserted += 1
        s.commit()
    return inserted
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `uv run pytest tests/test_gmail_ingestor.py -v`
Expected: 2 PASS.

- [ ] **Step 7: Commit**

```bash
git add src/blackmamba/core/gmail/client.py src/blackmamba/core/gmail/ingestor.py tests/test_gmail_ingestor.py tests/fixtures/emails/spotify_receipt.json
git commit -m "feat(gmail): client wrapper + ingestor with idempotency"
```

---

## Task 8: Normalize (LLM extraction via backboard)

**Files:**
- Create: `src/blackmamba/core/normalize.py`
- Test: `tests/test_normalize.py`, `tests/fixtures/backboard/spotify_extraction.json`

- [ ] **Step 1: Add recorded backboard response fixture**

```json
// tests/fixtures/backboard/spotify_extraction.json
{
  "response": "{\"kind\":\"charge\",\"merchant\":\"Spotify\",\"amount\":9.99,\"currency\":\"USD\",\"cadence_hint\":\"monthly\",\"is_trial\":false,\"trial_end_date\":null,\"next_charge_date\":null,\"confidence\":0.9}"
}
```

- [ ] **Step 2: Write failing tests**

```python
# tests/test_normalize.py
import json
from pathlib import Path
from datetime import datetime
import pytest
from blackmamba.core.gmail.client import GmailMessage
from blackmamba.core.normalize import extract_event, NORMALIZE_ASSISTANT_ID
from blackmamba.core.schemas import EventKind, Cadence

FIXTURES = Path(__file__).parent / "fixtures"

class FakeBackboard:
    def __init__(self, response_json):
        self._response_json = response_json
        self.calls = []
    async def send_message(self, assistant_id, content, thread_id=None):
        self.calls.append({"assistant_id": assistant_id, "content": content})
        return self._response_json

def _msg() -> GmailMessage:
    return GmailMessage(
        id="m1", received_at=datetime(2026, 1, 1),
        sender="noreply@spotify.com", subject="Your Spotify Premium receipt",
        snippet="paid $9.99", body_text="Thanks for being a Spotify Premium subscriber. You paid $9.99.",
        raw_payload={},
    )

@pytest.mark.asyncio
async def test_extract_event_returns_parsed_schema():
    resp = json.loads((FIXTURES / "backboard" / "spotify_extraction.json").read_text())
    bb = FakeBackboard(resp)
    ev = await extract_event(_msg(), bb)
    assert ev is not None
    assert ev.kind == EventKind.charge
    assert ev.merchant == "Spotify"
    assert ev.amount == 9.99
    assert ev.cadence_hint == Cadence.monthly
    assert bb.calls[0]["assistant_id"] == NORMALIZE_ASSISTANT_ID

@pytest.mark.asyncio
async def test_extract_event_returns_none_on_invalid_json():
    bb = FakeBackboard({"response": "not json at all"})
    ev = await extract_event(_msg(), bb)
    assert ev is None

@pytest.mark.asyncio
async def test_extract_event_returns_none_on_validation_error():
    bb = FakeBackboard({"response": '{"kind":"signup","merchant":""}'})  # empty merchant
    ev = await extract_event(_msg(), bb)
    assert ev is None
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `uv run pytest tests/test_normalize.py -v`
Expected: ImportError.

- [ ] **Step 4: Create `normalize.py`**

```python
# src/blackmamba/core/normalize.py
import json
from typing import Optional
from pydantic import ValidationError
from .schemas import ExtractedEvent
from .gmail.client import GmailMessage

NORMALIZE_ASSISTANT_ID = "blackmamba-normalize-v1"

PROMPT_TEMPLATE = """\
Extract subscription/billing info from this email as STRICT JSON matching this schema:
{{"kind": "signup|charge|renewal|trial_end|receipt|cancellation|other",
  "merchant": "string (non-empty)",
  "amount": number or null,
  "currency": "USD|EUR|... or null",
  "cadence_hint": "monthly|annual|trial|one_time|unknown",
  "is_trial": boolean,
  "trial_end_date": "ISO datetime or null",
  "next_charge_date": "ISO datetime or null",
  "confidence": number between 0 and 1}}

Output ONLY the JSON object, no prose.

From: {sender}
Subject: {subject}
Date: {received_at}

Body:
{body}
"""

class _ExtractClient:
    async def send_message(self, assistant_id: str, content: str, thread_id=None) -> dict: ...

async def extract_event(msg: GmailMessage, client: _ExtractClient) -> Optional[ExtractedEvent]:
    body = msg.body_text or msg.snippet
    body = body[:4000]
    content = PROMPT_TEMPLATE.format(
        sender=msg.sender, subject=msg.subject,
        received_at=msg.received_at.isoformat(), body=body,
    )
    resp = await client.send_message(NORMALIZE_ASSISTANT_ID, content)
    raw = resp.get("response", "")
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None
    try:
        return ExtractedEvent.model_validate(data)
    except ValidationError:
        return None
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest tests/test_normalize.py -v`
Expected: 3 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/blackmamba/core/normalize.py tests/test_normalize.py tests/fixtures/backboard/spotify_extraction.json
git commit -m "feat(core): LLM extraction via backboard with pydantic validation"
```

---

## Task 9: Detect & reconcile (pure logic)

**Files:**
- Create: `src/blackmamba/core/detect.py`
- Test: `tests/test_detect.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_detect.py
from datetime import datetime, timedelta
from blackmamba.core.schemas import ExtractedEvent, EventKind, Cadence
from blackmamba.core.detect import canonicalize, group_into_candidates, SubscriptionCandidate

def test_canonicalize_strips_amazon_prefix():
    assert canonicalize("AMZN*PRIME") == "amazon prime"
    assert canonicalize("Amazon Prime") == "amazon prime"

def test_canonicalize_lowercases_and_collapses_whitespace():
    assert canonicalize("  Netflix   ") == "netflix"
    assert canonicalize("SQ *Coffee Shop") == "coffee shop"

def test_group_into_candidates_merges_same_merchant_amount():
    now = datetime(2026, 1, 1)
    events = [
        ExtractedEvent(kind=EventKind.charge, merchant="Netflix", amount=15.99,
                       cadence_hint=Cadence.monthly),
        ExtractedEvent(kind=EventKind.charge, merchant="Netflix", amount=15.99,
                       cadence_hint=Cadence.monthly),
    ]
    cands = group_into_candidates([(events[0], now), (events[1], now + timedelta(days=30))])
    assert len(cands) == 1
    c = cands[0]
    assert c.canonical_name == "netflix"
    assert c.amount == 15.99
    assert c.cadence == Cadence.monthly
    assert c.first_seen_at == now
    assert c.last_seen_at == now + timedelta(days=30)

def test_group_separates_different_amounts():
    now = datetime(2026, 1, 1)
    events = [
        ExtractedEvent(kind=EventKind.charge, merchant="Netflix", amount=15.99),
        ExtractedEvent(kind=EventKind.charge, merchant="Netflix", amount=22.99),
    ]
    cands = group_into_candidates([(e, now) for e in events])
    assert len(cands) == 2

def test_signup_without_charge_marks_trial():
    now = datetime(2026, 1, 1)
    e = ExtractedEvent(kind=EventKind.signup, merchant="ChatGPT", is_trial=True,
                      trial_end_date=now + timedelta(days=7))
    cands = group_into_candidates([(e, now)])
    assert len(cands) == 1
    assert cands[0].cadence == Cadence.trial
    assert cands[0].trial_ends_at == now + timedelta(days=7)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_detect.py -v`
Expected: ImportError.

- [ ] **Step 3: Create `detect.py`**

```python
# src/blackmamba/core/detect.py
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Iterable, Optional
from .schemas import ExtractedEvent, EventKind, Cadence

@dataclass
class SubscriptionCandidate:
    merchant: str
    canonical_name: str
    cadence: Cadence
    amount: Optional[float]
    currency: Optional[str]
    first_seen_at: datetime
    last_seen_at: datetime
    trial_ends_at: Optional[datetime] = None
    next_charge_at: Optional[datetime] = None
    event_count: int = 0
    confidence_sum: float = 0.0
    raw_events: list[ExtractedEvent] = field(default_factory=list)

    @property
    def confidence(self) -> float:
        return self.confidence_sum / self.event_count if self.event_count else 0.0

_PREFIX_RE = re.compile(r"^(AMZN\*|SQ\s*\*|PAYPAL\s*\*|TST\*|POS\s+)", re.I)

def canonicalize(merchant: str) -> str:
    s = _PREFIX_RE.sub("", merchant).strip()
    s = re.sub(r"\s+", " ", s)
    return s.lower()

def _infer_cadence(event: ExtractedEvent) -> Cadence:
    if event.is_trial or event.kind == EventKind.signup and event.is_trial:
        return Cadence.trial
    if event.cadence_hint != Cadence.unknown:
        return event.cadence_hint
    return Cadence.unknown

def group_into_candidates(
    events: Iterable[tuple[ExtractedEvent, datetime]],
) -> list[SubscriptionCandidate]:
    by_key: dict[tuple[str, Optional[float]], SubscriptionCandidate] = {}
    for ev, received_at in events:
        key = (canonicalize(ev.merchant), ev.amount)
        cand = by_key.get(key)
        if cand is None:
            cand = SubscriptionCandidate(
                merchant=ev.merchant,
                canonical_name=canonicalize(ev.merchant),
                cadence=_infer_cadence(ev),
                amount=ev.amount,
                currency=ev.currency,
                first_seen_at=received_at,
                last_seen_at=received_at,
            )
            by_key[key] = cand
        cand.event_count += 1
        cand.confidence_sum += ev.confidence
        cand.raw_events.append(ev)
        cand.first_seen_at = min(cand.first_seen_at, received_at)
        cand.last_seen_at = max(cand.last_seen_at, received_at)
        if ev.trial_end_date and (cand.trial_ends_at is None or ev.trial_end_date > cand.trial_ends_at):
            cand.trial_ends_at = ev.trial_end_date
        if ev.next_charge_date and (cand.next_charge_at is None or ev.next_charge_date > cand.next_charge_at):
            cand.next_charge_at = ev.next_charge_date
        if cand.cadence == Cadence.unknown and ev.cadence_hint != Cadence.unknown:
            cand.cadence = ev.cadence_hint
        if ev.is_trial:
            cand.cadence = Cadence.trial
    return list(by_key.values())
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_detect.py -v`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blackmamba/core/detect.py tests/test_detect.py
git commit -m "feat(core): subscription detection and merchant canonicalization"
```

---

## Task 10: Classify (LLM + user_preference)

**Files:**
- Create: `src/blackmamba/core/classify.py`
- Test: `tests/test_classify.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_classify.py
import json
import pytest
from datetime import datetime
from sqlmodel import Session
from blackmamba.core.db import get_engine, init_db
from blackmamba.core.models import UserPreference
from blackmamba.core.detect import SubscriptionCandidate
from blackmamba.core.schemas import Cadence, Necessity
from blackmamba.core.classify import classify_candidate, CLASSIFY_ASSISTANT_ID

class FakeBackboard:
    def __init__(self, response_text):
        self._response_text = response_text
        self.calls = []
    async def send_message(self, assistant_id, content, thread_id=None):
        self.calls.append({"assistant_id": assistant_id, "content": content})
        return {"response": self._response_text, "thread_id": "u1"}

def _cand(name="Netflix"):
    now = datetime(2026, 1, 1)
    return SubscriptionCandidate(
        merchant=name, canonical_name=name.lower(),
        cadence=Cadence.monthly, amount=15.99, currency="USD",
        first_seen_at=now, last_seen_at=now, event_count=1, confidence_sum=0.9,
    )

@pytest.mark.asyncio
async def test_user_preference_overrides_llm(tmp_path):
    engine = get_engine(str(tmp_path / "t.db")); init_db(engine)
    with Session(engine) as s:
        s.add(UserPreference(
            key="merchant:netflix", necessity_default="necessary",
            updated_at=datetime.now(), reason="I watch this every night",
        ))
        s.commit()
    bb = FakeBackboard('{"necessity":"unnecessary","confidence":0.9,"reason":"streaming"}')
    result = await classify_candidate(_cand("Netflix"), bb, engine, user_thread_id="u1")
    assert result.necessity == Necessity.necessary
    assert result.confidence == 1.0
    assert "user override" in result.reason.lower()
    assert bb.calls == []  # LLM not called

@pytest.mark.asyncio
async def test_llm_classify_when_no_preference(tmp_path):
    engine = get_engine(str(tmp_path / "t.db")); init_db(engine)
    bb = FakeBackboard('{"necessity":"unnecessary","confidence":0.8,"reason":"streaming dupe"}')
    result = await classify_candidate(_cand("Netflix"), bb, engine, user_thread_id="u1")
    assert result.necessity == Necessity.unnecessary
    assert result.confidence == 0.8
    assert len(bb.calls) == 1
    assert bb.calls[0]["assistant_id"] == CLASSIFY_ASSISTANT_ID

@pytest.mark.asyncio
async def test_llm_invalid_json_returns_unknown(tmp_path):
    engine = get_engine(str(tmp_path / "t.db")); init_db(engine)
    bb = FakeBackboard("not json")
    result = await classify_candidate(_cand("Netflix"), bb, engine, user_thread_id="u1")
    assert result.necessity == Necessity.unknown
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_classify.py -v`
Expected: ImportError.

- [ ] **Step 3: Create `classify.py`**

```python
# src/blackmamba/core/classify.py
import json
from typing import Optional
from pydantic import ValidationError
from sqlmodel import Session, select
from sqlalchemy.engine import Engine
from .schemas import ClassificationResult, Necessity
from .models import UserPreference
from .detect import SubscriptionCandidate

CLASSIFY_ASSISTANT_ID = "blackmamba-classify-v1"

PROMPT = """\
Classify this subscription as necessary or unnecessary for this user.
Necessary = utilities, insurance, work-required, health.
Unnecessary = duplicate streaming, unused gym, forgotten apps.
Unknown = if you genuinely cannot tell.

Output ONLY JSON: {{"necessity":"necessary|unnecessary|unknown","confidence":0-1,"reason":"one sentence"}}

Subscription:
- Merchant: {merchant}
- Amount: {amount} {currency}
- Cadence: {cadence}
"""

class _LLM:
    async def send_message(self, assistant_id, content, thread_id=None) -> dict: ...

def _preference_key(cand: SubscriptionCandidate) -> str:
    return f"merchant:{cand.canonical_name}"

async def classify_candidate(
    cand: SubscriptionCandidate,
    client: _LLM,
    engine: Engine,
    user_thread_id: Optional[str] = None,
) -> ClassificationResult:
    key = _preference_key(cand)
    with Session(engine) as s:
        pref = s.exec(select(UserPreference).where(UserPreference.key == key)).first()
    if pref:
        return ClassificationResult(
            necessity=Necessity(pref.necessity_default),
            confidence=1.0,
            reason=f"User override: {pref.reason or 'no reason given'}",
        )
    content = PROMPT.format(
        merchant=cand.merchant, amount=cand.amount, currency=cand.currency or "",
        cadence=cand.cadence.value,
    )
    resp = await client.send_message(CLASSIFY_ASSISTANT_ID, content, thread_id=user_thread_id)
    raw = resp.get("response", "")
    try:
        data = json.loads(raw)
        return ClassificationResult.model_validate(data)
    except (json.JSONDecodeError, ValidationError, TypeError):
        return ClassificationResult(necessity=Necessity.unknown, confidence=0.0,
                                    reason="LLM output unparseable")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_classify.py -v`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blackmamba/core/classify.py tests/test_classify.py
git commit -m "feat(core): necessity classification with user-override precedence"
```

---

## Task 11: Pipeline glue (scan function)

**Files:**
- Create: `src/blackmamba/core/pipeline.py`
- Test: `tests/test_pipeline.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_pipeline.py
import json
from datetime import datetime
from pathlib import Path
import pytest
from sqlmodel import Session, select
from blackmamba.core.db import get_engine, init_db
from blackmamba.core.models import Subscription, RawEvent
from blackmamba.core.pipeline import scan
from blackmamba.core.gmail.client import GmailMessage

FIXTURES = Path(__file__).parent / "fixtures"

class FakeGmail:
    def __init__(self, msgs): self._msgs = msgs
    def list_message_ids(self, query=None, max_results=None):
        return [m["id"] for m in self._msgs]
    def get_message(self, mid):
        return GmailMessage.from_api_payload(next(m for m in self._msgs if m["id"] == mid))

class FakeBackboard:
    def __init__(self):
        self.responses = {
            "blackmamba-normalize-v1": {
                "response": '{"kind":"charge","merchant":"Spotify","amount":9.99,"currency":"USD","cadence_hint":"monthly","is_trial":false,"trial_end_date":null,"next_charge_date":null,"confidence":0.9}'
            },
            "blackmamba-classify-v1": {
                "response": '{"necessity":"unnecessary","confidence":0.8,"reason":"streaming"}'
            },
        }
    async def send_message(self, assistant_id, content, thread_id=None):
        return self.responses[assistant_id]

@pytest.mark.asyncio
async def test_scan_produces_subscription_row(tmp_path):
    engine = get_engine(str(tmp_path / "t.db")); init_db(engine)
    msg = json.loads((FIXTURES / "emails" / "spotify_receipt.json").read_text())
    summary = await scan(FakeGmail([msg]), FakeBackboard(), engine, user_thread_id="u1")
    assert summary.ingested == 1
    assert summary.subscriptions_upserted == 1
    with Session(engine) as s:
        subs = s.exec(select(Subscription)).all()
        assert len(subs) == 1
        assert subs[0].merchant == "Spotify"
        assert subs[0].cadence == "monthly"
        assert subs[0].necessity == "unnecessary"

@pytest.mark.asyncio
async def test_scan_is_rerunnable(tmp_path):
    engine = get_engine(str(tmp_path / "t.db")); init_db(engine)
    msg = json.loads((FIXTURES / "emails" / "spotify_receipt.json").read_text())
    await scan(FakeGmail([msg]), FakeBackboard(), engine, user_thread_id="u1")
    summary2 = await scan(FakeGmail([msg]), FakeBackboard(), engine, user_thread_id="u1")
    assert summary2.ingested == 0
    with Session(engine) as s:
        assert len(s.exec(select(Subscription)).all()) == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_pipeline.py -v`
Expected: ImportError.

- [ ] **Step 3: Create `pipeline.py`**

```python
# src/blackmamba/core/pipeline.py
import json
from dataclasses import dataclass
from datetime import datetime
from typing import Optional
from sqlmodel import Session, select
from sqlalchemy.engine import Engine
from .models import RawEvent, Subscription
from .gmail.ingestor import ingest_messages, GmailLike
from .gmail.client import GmailMessage
from .normalize import extract_event
from .detect import group_into_candidates, SubscriptionCandidate
from .classify import classify_candidate

@dataclass
class ScanSummary:
    ingested: int
    extracted: int
    subscriptions_upserted: int

class _LLM:
    async def send_message(self, assistant_id, content, thread_id=None) -> dict: ...

async def scan(
    gmail: GmailLike, llm: _LLM, engine: Engine, user_thread_id: Optional[str] = None,
) -> ScanSummary:
    ingested = ingest_messages(gmail, engine)

    extracted: list[tuple] = []
    with Session(engine) as s:
        rows = s.exec(select(RawEvent).where(RawEvent.parsed.is_(None))).all()
        for row in rows:
            payload = json.loads(row.raw_blob)
            msg = GmailMessage.from_api_payload(payload)
            ev = await extract_event(msg, llm)
            if ev is None:
                continue
            row.parsed = ev.model_dump_json()
            row.kind = ev.kind.value
            extracted.append((ev, row.received_at))
        s.commit()

    candidates = group_into_candidates(extracted)

    upserted = 0
    with Session(engine) as s:
        for cand in candidates:
            result = await classify_candidate(cand, llm, engine, user_thread_id=user_thread_id)
            existing = s.exec(
                select(Subscription).where(Subscription.canonical_name == cand.canonical_name)
            ).first()
            if existing:
                existing.last_seen_at = cand.last_seen_at
                existing.amount = cand.amount or existing.amount
                existing.cadence = cand.cadence.value
                existing.trial_ends_at = cand.trial_ends_at or existing.trial_ends_at
                existing.next_charge_at = cand.next_charge_at or existing.next_charge_at
                if existing.necessity_source != "user":
                    existing.necessity = result.necessity.value
                    existing.confidence = result.confidence
            else:
                s.add(Subscription(
                    merchant=cand.merchant, canonical_name=cand.canonical_name,
                    cadence=cand.cadence.value, amount=cand.amount, currency=cand.currency,
                    next_charge_at=cand.next_charge_at, trial_ends_at=cand.trial_ends_at,
                    status="active", necessity=result.necessity.value,
                    necessity_source="llm", confidence=result.confidence,
                    first_seen_at=cand.first_seen_at, last_seen_at=cand.last_seen_at,
                ))
            upserted += 1
        s.commit()

    return ScanSummary(ingested=ingested, extracted=len(extracted), subscriptions_upserted=upserted)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_pipeline.py -v`
Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blackmamba/core/pipeline.py tests/test_pipeline.py
git commit -m "feat(core): pipeline glue — scan() runs ingest→normalize→detect→classify"
```

---

## Task 12: TUI app shell + subscriptions screen

**Files:**
- Create: `src/blackmamba/tui/__init__.py`, `src/blackmamba/tui/app.py`, `src/blackmamba/tui/screens/__init__.py`, `src/blackmamba/tui/screens/subscriptions.py`

This task is dogfood-only; we test it manually via `uv run blackmamba`.

- [ ] **Step 1: Create the TUI package init files**

```python
# src/blackmamba/tui/__init__.py
```

```python
# src/blackmamba/tui/screens/__init__.py
```

- [ ] **Step 2: Create the subscriptions screen**

```python
# src/blackmamba/tui/screens/subscriptions.py
from textual.app import ComposeResult
from textual.containers import Vertical
from textual.screen import Screen
from textual.widgets import DataTable, Header, Footer, Static
from sqlmodel import Session, select
from sqlalchemy.engine import Engine
from blackmamba.core.models import Subscription

class SubscriptionsScreen(Screen):
    BINDINGS = [("r", "refresh", "Refresh"), ("q", "quit", "Quit")]

    def __init__(self, engine: Engine):
        super().__init__()
        self._engine = engine

    def compose(self) -> ComposeResult:
        yield Header(show_clock=False)
        yield Vertical(
            Static("BlackMamba — detected subscriptions", id="title"),
            DataTable(id="subs"),
        )
        yield Footer()

    def on_mount(self) -> None:
        t = self.query_one("#subs", DataTable)
        t.add_columns("Merchant", "Cadence", "Amount", "Necessity", "Confidence", "Trial ends")
        self.refresh_table()

    def action_refresh(self) -> None:
        self.refresh_table()

    def refresh_table(self) -> None:
        t = self.query_one("#subs", DataTable)
        t.clear()
        with Session(self._engine) as s:
            rows = s.exec(select(Subscription).order_by(Subscription.merchant)).all()
            for r in rows:
                t.add_row(
                    r.merchant, r.cadence,
                    f"{r.amount:.2f} {r.currency or ''}" if r.amount else "-",
                    r.necessity, f"{r.confidence:.2f}",
                    r.trial_ends_at.date().isoformat() if r.trial_ends_at else "-",
                )
```

- [ ] **Step 3: Create the app entry point**

```python
# src/blackmamba/tui/app.py
import asyncio
import os
from pathlib import Path
from dotenv import load_dotenv
from textual.app import App
from blackmamba.core.db import get_engine, init_db
from blackmamba.core.gmail.auth import ensure_credentials
from blackmamba.core.gmail.client import GmailAPI
from blackmamba.core.backboard import BackboardClient
from blackmamba.core.pipeline import scan
from blackmamba.tui.screens.subscriptions import SubscriptionsScreen

class BlackMambaApp(App):
    BINDINGS = [("s", "scan", "Scan Gmail")]

    def __init__(self, engine, gmail_factory, llm):
        super().__init__()
        self._engine = engine
        self._gmail_factory = gmail_factory
        self._llm = llm

    def on_mount(self) -> None:
        self.push_screen(SubscriptionsScreen(self._engine))

    async def action_scan(self) -> None:
        gmail = self._gmail_factory()
        summary = await scan(gmail, self._llm, self._engine, user_thread_id="local-user")
        self.notify(f"Ingested {summary.ingested}, extracted {summary.extracted}, "
                    f"subscriptions {summary.subscriptions_upserted}")
        screen = self.screen
        if isinstance(screen, SubscriptionsScreen):
            screen.refresh_table()

def main() -> None:
    load_dotenv()
    db_path = os.environ.get("BLACKMAMBA_DB_PATH", "~/.blackmamba/blackmamba.db")
    engine = get_engine(db_path); init_db(engine)
    client_secret = os.environ.get("GMAIL_OAUTH_CLIENT_PATH", "~/.blackmamba/gmail_client_secret.json")
    creds = ensure_credentials(client_secret)
    def gmail_factory(): return GmailAPI(creds)
    llm = BackboardClient(
        api_key=os.environ["BACKBOARD_API_KEY"],
        base_url=os.environ.get("BACKBOARD_BASE_URL", "https://api.backboard.io"),
    )
    BlackMambaApp(engine=engine, gmail_factory=gmail_factory, llm=llm).run()

if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Verify imports load**

Run: `uv run python -c "from blackmamba.tui.app import BlackMambaApp; print('ok')"`
Expected: `ok`.

- [ ] **Step 5: Commit**

```bash
git add src/blackmamba/tui/
git commit -m "feat(tui): Textual app with subscriptions list and scan action"
```

---

## Task 13: README with dev setup

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace README contents**

```markdown
# BlackMamba

Find your subscriptions automatically. Plan 1: read Gmail, detect subscriptions, classify them in a TUI. Plans 2 (browser-driven cancellation) and 3 (bank statements) build on this.

## Dev setup

1. Install [uv](https://github.com/astral-sh/uv).
2. `uv venv && uv pip install -e ".[dev]"`
3. Create a Google Cloud OAuth client (Desktop app) at https://console.cloud.google.com/apis/credentials, enable the Gmail API, download `client_secret.json` to `~/.blackmamba/gmail_client_secret.json`.
4. `cp .env.example .env` and fill in `BACKBOARD_API_KEY`.
5. `uv run blackmamba` — first run opens a browser for Gmail OAuth.
6. Press `s` in the TUI to scan, `r` to refresh, `q` to quit.

## Tests

`uv run pytest -v`

## Layout

- `blackmamba.core` — pure logic, no UI imports. Pipeline: `gmail_ingestor → normalize → detect → classify → store`.
- `blackmamba.tui` — Textual UI. Thin layer that calls into `core`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README with dev setup and architecture summary"
```

---

## Task 14: End-to-end dogfood verification

This task is manual — no test code, no commit unless something is broken.

- [ ] **Step 1: Run the full test suite**

Run: `uv run pytest -v`
Expected: all green.

- [ ] **Step 2: Provision Gmail OAuth client (one-time)**

Each dev creates a Google Cloud OAuth client (Desktop app), enables Gmail API, downloads `client_secret.json` to `~/.blackmamba/gmail_client_secret.json`. See README.

- [ ] **Step 3: Set `BACKBOARD_API_KEY` in `.env`**

- [ ] **Step 4: Launch TUI and scan**

Run: `uv run blackmamba`
- First run opens browser for OAuth — sign in to Gmail.
- Press `s` to scan.
- After a minute or two, table should populate with detected subscriptions.

- [ ] **Step 5: File issues**

For each subscription that's mislabeled, wrong cadence, or missed entirely: open an issue in the repo with the email subject + sender + what went wrong. These become the input set for Plan 1's iteration loop (which we'll handle outside this plan).

---

## Self-review notes

- Spec section 2 (statement ingest, unsubscribe agent) intentionally not covered here — Plans 2 and 3.
- Spec section 9 (failure modes) covered in code-level guards (retry in backboard, `parsed = null` on extract failure, IntegrityError on dup ingest); the unsubscribe-specific failure modes belong to Plan 2.
- Spec section 10 (testing strategy): unit + recorded-fixture pattern used throughout. Dogfood in Task 14.
- Open question (canonical-name seeding): handled by `_PREFIX_RE` covering common prefixes; further canonicalization grows from `user_preference` corrections later.
