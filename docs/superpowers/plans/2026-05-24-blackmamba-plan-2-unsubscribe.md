# BlackMamba — Plan 2: Unsubscribe Agent + Playbook Repo

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From the TUI, user picks a detected subscription and clicks "cancel". The agent looks up a playbook from a shared GitHub repo, drives `browser-use` against the user's real Chrome profile (default), records transcript + screenshots, and either completes the cancellation or surfaces a clear human-required step. Run telemetry persists locally.

**Architecture:** Adds `playbook` and `cancel_attempt` and `playbook_run` tables plus a `core/unsubscribe/` subpackage. A local cache mirrors a public `blackmamba-playbooks` GitHub repo of YAML files. The orchestrator selects playbooks by `merchant + region`, decides which path to run (no playbook → pure LLM agent; plaintext → goal-driven; plaintext + selectors → hybrid), and delegates browser control to `browser-use`. The TUI gets a per-row "Cancel" action and a live run viewer.

**Tech Stack:** Same as Plan 1, plus `browser-use` (LLM-driven browser automation built on Playwright), `pyyaml`, `gitpython`, and Playwright's bundled Chromium (or user's installed Chrome via `executable_path`).

**Depends on:** Plan 1 complete (`blackmamba.core` package, SQLite store, `BackboardClient`, TUI shell).

---

## File Structure (additions)

```
src/blackmamba/core/unsubscribe/
  __init__.py
  schema.py              # pydantic Playbook model (matches YAML)
  cache.py               # git pull + load YAML files → DB rows
  selector.py            # pick playbook by merchant + region
  outcome.py             # confirmation-detection heuristics
  agent.py               # browser-use orchestration: no/plaintext/hybrid paths
  recorder.py            # screenshot + transcript recording

src/blackmamba/tui/screens/
  cancel.py              # live run viewer (steps, screenshot panel, abort)

tests/
  test_playbook_schema.py
  test_playbook_cache.py
  test_playbook_selector.py
  test_outcome.py
  test_unsubscribe_agent.py
  fixtures/playbooks/
    netflix.yaml
    spotify.yaml
```

Plus changes to existing files:
- `src/blackmamba/core/models.py` — add `Playbook`, `CancelAttempt`, `PlaybookRun`.
- `src/blackmamba/tui/screens/subscriptions.py` — add `c` binding to launch cancel screen.

---

## Task 1: Playbook YAML schema

**Files:**
- Create: `src/blackmamba/core/unsubscribe/__init__.py`, `src/blackmamba/core/unsubscribe/schema.py`
- Test: `tests/test_playbook_schema.py`, `tests/fixtures/playbooks/netflix.yaml`

- [ ] **Step 1: Create the Netflix fixture**

```yaml
# tests/fixtures/playbooks/netflix.yaml
merchant: Netflix
canonical_name: netflix
cancel_url: https://www.netflix.com/youraccount
region: any
language: en
requires_2fa: false
requires_phone: false
estimated_minutes: 2
source: community
author: aarya
version: 1
steps: |
  1. Open the account page.
  2. Click "Cancel Membership" under Membership & Billing.
  3. Click "Finish Cancellation" to confirm.
selectors:
  cancel_button: 'a[href*="cancelplan"]'
  confirm_button: 'button[data-uia="action-finish-cancellation"]'
```

- [ ] **Step 2: Write failing tests**

```python
# tests/test_playbook_schema.py
from pathlib import Path
import pytest
from pydantic import ValidationError
from blackmamba.core.unsubscribe.schema import Playbook, load_playbook_yaml

FIX = Path(__file__).parent / "fixtures" / "playbooks"

def test_parse_minimal_playbook():
    pb = Playbook(
        merchant="X", canonical_name="x", cancel_url="https://x.com",
        steps="1. Click cancel.", version=1,
    )
    assert pb.region == "any"
    assert pb.selectors == {}
    assert pb.requires_2fa is False

def test_load_netflix_fixture():
    pb = load_playbook_yaml(FIX / "netflix.yaml")
    assert pb.canonical_name == "netflix"
    assert pb.selectors["cancel_button"].startswith("a[href")
    assert "Cancel Membership" in pb.steps

def test_rejects_empty_steps():
    with pytest.raises(ValidationError):
        Playbook(merchant="X", canonical_name="x",
                 cancel_url="https://x.com", steps="", version=1)

def test_rejects_invalid_url():
    with pytest.raises(ValidationError):
        Playbook(merchant="X", canonical_name="x",
                 cancel_url="not-a-url", steps="x", version=1)
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `uv run pytest tests/test_playbook_schema.py -v`
Expected: ImportError.

- [ ] **Step 4: Create the schema module**

```python
# src/blackmamba/core/unsubscribe/__init__.py
```

```python
# src/blackmamba/core/unsubscribe/schema.py
from pathlib import Path
from typing import Optional
import yaml
from pydantic import BaseModel, Field, HttpUrl, field_validator

class Playbook(BaseModel):
    merchant: str
    canonical_name: str = Field(min_length=1)
    cancel_url: HttpUrl
    region: str = "any"
    language: str = "en"
    requires_2fa: bool = False
    requires_phone: bool = False
    estimated_minutes: int = 5
    source: str = "community"
    author: Optional[str] = None
    version: int = Field(ge=1)
    steps: str = Field(min_length=1)
    selectors: dict[str, str] = Field(default_factory=dict)
    upstream_url: Optional[HttpUrl] = None

    @field_validator("steps")
    @classmethod
    def steps_nonblank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("steps cannot be blank")
        return v

def load_playbook_yaml(path: Path) -> Playbook:
    with open(path, "r") as f:
        data = yaml.safe_load(f)
    return Playbook.model_validate(data)
```

- [ ] **Step 5: Add `pyyaml` to deps**

Modify `pyproject.toml` — add `"pyyaml>=6"` and `"gitpython>=3.1"` to `dependencies`. Run `uv pip install -e ".[dev]"`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `uv run pytest tests/test_playbook_schema.py -v`
Expected: 4 PASS.

- [ ] **Step 7: Commit**

```bash
git add pyproject.toml src/blackmamba/core/unsubscribe/__init__.py src/blackmamba/core/unsubscribe/schema.py tests/test_playbook_schema.py tests/fixtures/playbooks/netflix.yaml
git commit -m "feat(unsubscribe): Playbook pydantic schema + YAML loader"
```

---

## Task 2: Playbook + CancelAttempt + PlaybookRun tables

**Files:**
- Modify: `src/blackmamba/core/models.py`
- Test: `tests/test_models_unsubscribe.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_models_unsubscribe.py
from datetime import datetime
from sqlmodel import Session, select
from blackmamba.core.db import get_engine, init_db
from blackmamba.core.models import Playbook, CancelAttempt, PlaybookRun, Subscription

def test_playbook_roundtrip(tmp_path):
    engine = get_engine(str(tmp_path / "t.db")); init_db(engine)
    with Session(engine) as s:
        pb = Playbook(
            merchant="Netflix", canonical_name="netflix",
            cancel_url="https://x", region="any", language="en",
            requires_2fa=False, requires_phone=False, estimated_minutes=2,
            source="community", version=1,
            steps_text="1. cancel", selectors_json="{}",
            updated_at=datetime.now(),
        )
        s.add(pb); s.commit(); s.refresh(pb)
        assert pb.id is not None

def test_cancel_attempt_linked_to_subscription(tmp_path):
    engine = get_engine(str(tmp_path / "t.db")); init_db(engine)
    with Session(engine) as s:
        sub = Subscription(merchant="X", canonical_name="x", cadence="monthly",
                           status="active", necessity="unnecessary",
                           necessity_source="llm", confidence=0.5,
                           first_seen_at=datetime.now(), last_seen_at=datetime.now())
        s.add(sub); s.commit(); s.refresh(sub)
        att = CancelAttempt(subscription_id=sub.id, started_at=datetime.now(),
                            outcome="success", transcript_json="[]", screenshots_json="[]")
        s.add(att); s.commit(); s.refresh(att)
        assert att.id is not None
        assert att.subscription_id == sub.id

def test_playbook_run_linked(tmp_path):
    engine = get_engine(str(tmp_path / "t.db")); init_db(engine)
    with Session(engine) as s:
        pb = Playbook(merchant="X", canonical_name="x", cancel_url="https://x",
                      region="any", language="en", requires_2fa=False, requires_phone=False,
                      estimated_minutes=1, source="community", version=1,
                      steps_text="1.", selectors_json="{}", updated_at=datetime.now())
        s.add(pb); s.commit(); s.refresh(pb)
        sub = Subscription(merchant="X", canonical_name="x", cadence="monthly",
                           status="active", necessity="unnecessary",
                           necessity_source="llm", confidence=0.5,
                           first_seen_at=datetime.now(), last_seen_at=datetime.now())
        s.add(sub); s.commit(); s.refresh(sub)
        att = CancelAttempt(subscription_id=sub.id, started_at=datetime.now(),
                            outcome="success", transcript_json="[]", screenshots_json="[]")
        s.add(att); s.commit(); s.refresh(att)
        run = PlaybookRun(playbook_id=pb.id, playbook_version=1,
                          cancel_attempt_id=att.id, succeeded=True,
                          duration_ms=1234, ran_at=datetime.now(),
                          client_version="0.1.0", contributed_back=False)
        s.add(run); s.commit(); s.refresh(run)
        assert run.id is not None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_models_unsubscribe.py -v`
Expected: ImportError on `Playbook`, `CancelAttempt`, `PlaybookRun`.

- [ ] **Step 3: Add tables to `models.py`**

Append to `src/blackmamba/core/models.py`:

```python
class Playbook(SQLModel, table=True):
    __tablename__ = "playbook"
    id: Optional[int] = Field(default=None, primary_key=True)
    merchant: str
    canonical_name: str = Field(index=True)
    cancel_url: str
    region: str = "any"
    language: str = "en"
    requires_2fa: bool = False
    requires_phone: bool = False
    estimated_minutes: int = 5
    source: str = "community"
    author: Optional[str] = None
    version: int = 1
    steps_text: str
    selectors_json: str = "{}"
    upstream_url: Optional[str] = None
    updated_at: datetime

class CancelAttempt(SQLModel, table=True):
    __tablename__ = "cancel_attempt"
    id: Optional[int] = Field(default=None, primary_key=True)
    subscription_id: int = Field(foreign_key="subscription.id", index=True)
    started_at: datetime
    ended_at: Optional[datetime] = None
    outcome: str  # success | failed | needs_human | manual | aborted
    playbook_id: Optional[int] = Field(default=None, foreign_key="playbook.id")
    playbook_version: Optional[int] = None
    transcript_json: str = "[]"
    screenshots_json: str = "[]"  # JSON list of file paths

class PlaybookRun(SQLModel, table=True):
    __tablename__ = "playbook_run"
    id: Optional[int] = Field(default=None, primary_key=True)
    playbook_id: int = Field(foreign_key="playbook.id", index=True)
    playbook_version: int
    cancel_attempt_id: int = Field(foreign_key="cancel_attempt.id")
    succeeded: bool
    failure_step: Optional[str] = None
    failure_reason: Optional[str] = None
    duration_ms: int
    ran_at: datetime
    client_version: str
    contributed_back: bool = False
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_models_unsubscribe.py -v`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blackmamba/core/models.py tests/test_models_unsubscribe.py
git commit -m "feat(unsubscribe): playbook, cancel_attempt, playbook_run tables"
```

---

## Task 3: Playbook cache (git pull + load YAML → DB)

**Files:**
- Create: `src/blackmamba/core/unsubscribe/cache.py`
- Test: `tests/test_playbook_cache.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_playbook_cache.py
import json
import shutil
from datetime import datetime
from pathlib import Path
import yaml
from sqlmodel import Session, select
from blackmamba.core.db import get_engine, init_db
from blackmamba.core.models import Playbook
from blackmamba.core.unsubscribe.cache import sync_playbooks_from_dir

FIX = Path(__file__).parent / "fixtures" / "playbooks"

def test_sync_inserts_new_playbook(tmp_path):
    engine = get_engine(str(tmp_path / "t.db")); init_db(engine)
    n = sync_playbooks_from_dir(FIX, engine)
    assert n == 1
    with Session(engine) as s:
        rows = s.exec(select(Playbook)).all()
        assert len(rows) == 1
        assert rows[0].canonical_name == "netflix"
        assert json.loads(rows[0].selectors_json)["cancel_button"].startswith("a[href")

def test_sync_updates_existing_on_higher_version(tmp_path):
    engine = get_engine(str(tmp_path / "t.db")); init_db(engine)
    sync_playbooks_from_dir(FIX, engine)
    # write a v2 to a tmp dir
    src = FIX / "netflix.yaml"
    dst_dir = tmp_path / "pb"
    dst_dir.mkdir()
    data = yaml.safe_load(src.read_text())
    data["version"] = 2
    data["steps"] = "updated steps"
    (dst_dir / "netflix.yaml").write_text(yaml.safe_dump(data))
    n = sync_playbooks_from_dir(dst_dir, engine)
    assert n == 1
    with Session(engine) as s:
        pb = s.exec(select(Playbook).where(Playbook.canonical_name == "netflix")).first()
        assert pb.version == 2
        assert pb.steps_text == "updated steps"

def test_sync_skips_lower_version(tmp_path):
    engine = get_engine(str(tmp_path / "t.db")); init_db(engine)
    sync_playbooks_from_dir(FIX, engine)  # v1
    dst_dir = tmp_path / "pb"
    dst_dir.mkdir()
    data = yaml.safe_load((FIX / "netflix.yaml").read_text())
    data["version"] = 1
    data["steps"] = "stale"
    (dst_dir / "netflix.yaml").write_text(yaml.safe_dump(data))
    n = sync_playbooks_from_dir(dst_dir, engine)
    assert n == 0  # nothing updated
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_playbook_cache.py -v`
Expected: ImportError.

- [ ] **Step 3: Create `cache.py`**

```python
# src/blackmamba/core/unsubscribe/cache.py
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional
from sqlmodel import Session, select
from sqlalchemy.engine import Engine
from ..models import Playbook as PlaybookRow
from .schema import load_playbook_yaml

log = logging.getLogger(__name__)

def sync_playbooks_from_dir(directory: Path, engine: Engine) -> int:
    """Load all *.yaml files in directory. Insert new rows or replace
    existing rows when the YAML version is strictly higher. Returns the
    number of rows inserted or updated."""
    changed = 0
    with Session(engine) as s:
        for yml in sorted(Path(directory).glob("*.yaml")):
            try:
                pb = load_playbook_yaml(yml)
            except Exception as e:
                log.warning("skipping %s: %s", yml.name, e)
                continue
            existing = s.exec(
                select(PlaybookRow).where(PlaybookRow.canonical_name == pb.canonical_name)
            ).first()
            if existing and existing.version >= pb.version:
                continue
            now = datetime.now()
            if existing:
                existing.merchant = pb.merchant
                existing.cancel_url = str(pb.cancel_url)
                existing.region = pb.region
                existing.language = pb.language
                existing.requires_2fa = pb.requires_2fa
                existing.requires_phone = pb.requires_phone
                existing.estimated_minutes = pb.estimated_minutes
                existing.source = pb.source
                existing.author = pb.author
                existing.version = pb.version
                existing.steps_text = pb.steps
                existing.selectors_json = json.dumps(pb.selectors)
                existing.upstream_url = str(pb.upstream_url) if pb.upstream_url else None
                existing.updated_at = now
            else:
                s.add(PlaybookRow(
                    merchant=pb.merchant, canonical_name=pb.canonical_name,
                    cancel_url=str(pb.cancel_url), region=pb.region, language=pb.language,
                    requires_2fa=pb.requires_2fa, requires_phone=pb.requires_phone,
                    estimated_minutes=pb.estimated_minutes, source=pb.source,
                    author=pb.author, version=pb.version, steps_text=pb.steps,
                    selectors_json=json.dumps(pb.selectors),
                    upstream_url=str(pb.upstream_url) if pb.upstream_url else None,
                    updated_at=now,
                ))
            changed += 1
        s.commit()
    return changed

def sync_playbooks_from_git(repo_url: str, local_path: Path, engine: Engine) -> int:
    """Clone or pull the playbooks repo and sync its `playbooks/` dir."""
    from git import Repo
    local_path = Path(local_path).expanduser()
    if (local_path / ".git").exists():
        Repo(local_path).remotes.origin.pull()
    else:
        local_path.parent.mkdir(parents=True, exist_ok=True)
        Repo.clone_from(repo_url, local_path)
    pb_dir = local_path / "playbooks"
    if not pb_dir.exists():
        pb_dir = local_path
    return sync_playbooks_from_dir(pb_dir, engine)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_playbook_cache.py -v`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blackmamba/core/unsubscribe/cache.py tests/test_playbook_cache.py
git commit -m "feat(unsubscribe): playbook cache — sync YAML dir + git pull"
```

---

## Task 4: Playbook selector

**Files:**
- Create: `src/blackmamba/core/unsubscribe/selector.py`
- Test: `tests/test_playbook_selector.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_playbook_selector.py
import json
from datetime import datetime
from sqlmodel import Session
from blackmamba.core.db import get_engine, init_db
from blackmamba.core.models import Playbook
from blackmamba.core.unsubscribe.selector import select_playbook

def _insert(s, **overrides):
    base = dict(
        merchant="Netflix", canonical_name="netflix",
        cancel_url="https://netflix.com", region="any", language="en",
        requires_2fa=False, requires_phone=False, estimated_minutes=2,
        source="community", version=1,
        steps_text="1.", selectors_json="{}", updated_at=datetime.now(),
    )
    base.update(overrides)
    s.add(Playbook(**base))

def test_select_returns_region_specific_when_present(tmp_path):
    engine = get_engine(str(tmp_path / "t.db")); init_db(engine)
    with Session(engine) as s:
        _insert(s, region="any", steps_text="generic")
        _insert(s, region="US", steps_text="us-specific")
        s.commit()
    pb = select_playbook("netflix", region="US", engine=engine)
    assert pb is not None
    assert pb.steps_text == "us-specific"

def test_select_falls_back_to_any(tmp_path):
    engine = get_engine(str(tmp_path / "t.db")); init_db(engine)
    with Session(engine) as s:
        _insert(s, region="any", steps_text="generic")
        s.commit()
    pb = select_playbook("netflix", region="UK", engine=engine)
    assert pb is not None
    assert pb.steps_text == "generic"

def test_select_returns_none_when_no_playbook(tmp_path):
    engine = get_engine(str(tmp_path / "t.db")); init_db(engine)
    assert select_playbook("netflix", region="US", engine=engine) is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_playbook_selector.py -v`
Expected: ImportError.

- [ ] **Step 3: Create `selector.py`**

```python
# src/blackmamba/core/unsubscribe/selector.py
from typing import Optional
from sqlmodel import Session, select
from sqlalchemy.engine import Engine
from ..models import Playbook

def select_playbook(canonical_name: str, region: str, engine: Engine) -> Optional[Playbook]:
    with Session(engine) as s:
        rows = s.exec(
            select(Playbook).where(Playbook.canonical_name == canonical_name)
        ).all()
        if not rows:
            return None
        exact = [r for r in rows if r.region.lower() == region.lower()]
        if exact:
            return max(exact, key=lambda r: r.version)
        any_region = [r for r in rows if r.region == "any"]
        if any_region:
            return max(any_region, key=lambda r: r.version)
        return None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_playbook_selector.py -v`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blackmamba/core/unsubscribe/selector.py tests/test_playbook_selector.py
git commit -m "feat(unsubscribe): playbook selector by canonical_name + region"
```

---

## Task 5: Outcome heuristics

**Files:**
- Create: `src/blackmamba/core/unsubscribe/outcome.py`
- Test: `tests/test_outcome.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_outcome.py
from blackmamba.core.unsubscribe.outcome import detect_outcome, Outcome

def test_clear_success_text():
    assert detect_outcome(
        "Your subscription has been canceled. You'll continue to have access until Jan 15."
    ) == Outcome.success

def test_pause_disguised_as_cancel_is_ambiguous():
    assert detect_outcome(
        "We've paused your membership for 3 months. Resume anytime."
    ) == Outcome.ambiguous

def test_explicit_failure():
    assert detect_outcome(
        "We couldn't process your cancellation. Please call us at 1-800-..."
    ) == Outcome.needs_human

def test_no_signal_unknown():
    assert detect_outcome("Welcome back!") == Outcome.unknown
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_outcome.py -v`
Expected: ImportError.

- [ ] **Step 3: Create `outcome.py`**

```python
# src/blackmamba/core/unsubscribe/outcome.py
import re
from enum import Enum

class Outcome(str, Enum):
    success = "success"
    needs_human = "needs_human"
    ambiguous = "ambiguous"
    unknown = "unknown"

_SUCCESS = re.compile(
    r"\b(cancell?ed|cancellation (?:is )?(?:complete|confirmed)|"
    r"your (?:subscription|membership|plan) (?:has been|is now) cancell?ed|"
    r"you (?:have|'ve) (?:successfully )?cancell?ed)\b",
    re.I,
)
_NEEDS_HUMAN = re.compile(
    r"\b(couldn[\'’]t process|please call|contact (?:our|customer) (?:support|service)|"
    r"sign in to (?:cancel|continue)|verify your identity)\b",
    re.I,
)
_AMBIGUOUS = re.compile(
    r"\b(paused|pause your|snoozed|on hold|downgrad(?:e|ed)|switched to (?:free|basic))\b",
    re.I,
)

def detect_outcome(text: str) -> Outcome:
    t = text or ""
    if _NEEDS_HUMAN.search(t):
        return Outcome.needs_human
    if _AMBIGUOUS.search(t):
        return Outcome.ambiguous
    if _SUCCESS.search(t):
        return Outcome.success
    return Outcome.unknown
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_outcome.py -v`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blackmamba/core/unsubscribe/outcome.py tests/test_outcome.py
git commit -m "feat(unsubscribe): outcome heuristics (success/ambiguous/needs_human)"
```

---

## Task 6: Unsubscribe agent (orchestrator over browser-use)

**Files:**
- Create: `src/blackmamba/core/unsubscribe/agent.py`, `src/blackmamba/core/unsubscribe/recorder.py`
- Test: `tests/test_unsubscribe_agent.py`

The real `browser-use` is too heavy for unit tests; we depend on an injected `BrowserAgent` protocol and test against a fake. End-to-end real-browser runs are dogfood (Task 8).

- [ ] **Step 1: Write failing tests**

```python
# tests/test_unsubscribe_agent.py
import json
import pytest
from datetime import datetime
from pathlib import Path
from sqlmodel import Session, select
from blackmamba.core.db import get_engine, init_db
from blackmamba.core.models import Playbook, Subscription, CancelAttempt, PlaybookRun
from blackmamba.core.unsubscribe.agent import run_unsubscribe, UnsubscribeRequest
from blackmamba.core.unsubscribe.outcome import Outcome

class FakeBrowser:
    """Returns a scripted final-page text + screenshot path."""
    def __init__(self, final_text, ok=True):
        self._final_text = final_text
        self._ok = ok
        self.calls = []
    async def run(self, goal: str, start_url: str, selectors: dict,
                  screenshot_dir: Path):
        self.calls.append({"goal": goal, "start_url": start_url, "selectors": selectors})
        sd = Path(screenshot_dir); sd.mkdir(parents=True, exist_ok=True)
        screenshot = sd / "final.png"
        screenshot.write_bytes(b"")
        return {
            "ok": self._ok,
            "final_text": self._final_text,
            "screenshots": [str(screenshot)],
            "transcript": [{"step": "navigated", "url": start_url}],
        }

def _seed(engine, *, has_playbook=True):
    with Session(engine) as s:
        sub = Subscription(merchant="Netflix", canonical_name="netflix",
                           cadence="monthly", amount=15.99, currency="USD",
                           status="active", necessity="unnecessary",
                           necessity_source="llm", confidence=0.7,
                           first_seen_at=datetime.now(), last_seen_at=datetime.now(),
                           cancel_url="https://netflix.com/youraccount")
        s.add(sub); s.commit(); s.refresh(sub)
        if has_playbook:
            s.add(Playbook(merchant="Netflix", canonical_name="netflix",
                           cancel_url="https://netflix.com/youraccount", region="any",
                           language="en", requires_2fa=False, requires_phone=False,
                           estimated_minutes=2, source="community", version=1,
                           steps_text="1. Cancel.", selectors_json='{"x":"y"}',
                           updated_at=datetime.now()))
            s.commit()
        return sub.id

@pytest.mark.asyncio
async def test_success_records_attempt_and_run(tmp_path):
    engine = get_engine(str(tmp_path / "t.db")); init_db(engine)
    sub_id = _seed(engine)
    br = FakeBrowser("Your subscription has been canceled.")
    req = UnsubscribeRequest(subscription_id=sub_id, region="any",
                             screenshot_dir=tmp_path / "shots", client_version="0.2.0")
    att = await run_unsubscribe(req, engine, br)
    assert att.outcome == Outcome.success.value
    with Session(engine) as s:
        attempts = s.exec(select(CancelAttempt)).all()
        runs = s.exec(select(PlaybookRun)).all()
        assert len(attempts) == 1 and len(runs) == 1
        assert runs[0].succeeded is True
        sub = s.get(Subscription, sub_id)
        assert sub.status == "canceled"

@pytest.mark.asyncio
async def test_ambiguous_marks_needs_human_and_keeps_active(tmp_path):
    engine = get_engine(str(tmp_path / "t.db")); init_db(engine)
    sub_id = _seed(engine)
    br = FakeBrowser("We've paused your membership for 3 months.")
    req = UnsubscribeRequest(subscription_id=sub_id, region="any",
                             screenshot_dir=tmp_path / "shots", client_version="0.2.0")
    att = await run_unsubscribe(req, engine, br)
    assert att.outcome == Outcome.ambiguous.value
    with Session(engine) as s:
        sub = s.get(Subscription, sub_id)
        assert sub.status == "active"

@pytest.mark.asyncio
async def test_no_playbook_still_runs_with_goal_only(tmp_path):
    engine = get_engine(str(tmp_path / "t.db")); init_db(engine)
    sub_id = _seed(engine, has_playbook=False)
    br = FakeBrowser("Your subscription has been canceled.")
    req = UnsubscribeRequest(subscription_id=sub_id, region="any",
                             screenshot_dir=tmp_path / "shots", client_version="0.2.0")
    att = await run_unsubscribe(req, engine, br)
    assert att.outcome == Outcome.success.value
    assert br.calls[0]["selectors"] == {}
    assert "Cancel my subscription" in br.calls[0]["goal"]
    with Session(engine) as s:
        runs = s.exec(select(PlaybookRun)).all()
        assert len(runs) == 0  # no playbook → no playbook_run row
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_unsubscribe_agent.py -v`
Expected: ImportError.

- [ ] **Step 3: Create `recorder.py`**

```python
# src/blackmamba/core/unsubscribe/recorder.py
import json
from datetime import datetime
from pathlib import Path
from sqlmodel import Session
from sqlalchemy.engine import Engine
from ..models import CancelAttempt, PlaybookRun

def record_attempt(
    engine: Engine,
    *,
    subscription_id: int,
    started_at: datetime,
    ended_at: datetime,
    outcome: str,
    playbook_id: int | None,
    playbook_version: int | None,
    transcript: list,
    screenshots: list[str],
) -> CancelAttempt:
    att = CancelAttempt(
        subscription_id=subscription_id, started_at=started_at, ended_at=ended_at,
        outcome=outcome, playbook_id=playbook_id, playbook_version=playbook_version,
        transcript_json=json.dumps(transcript), screenshots_json=json.dumps(screenshots),
    )
    with Session(engine) as s:
        s.add(att); s.commit(); s.refresh(att)
    return att

def record_playbook_run(
    engine: Engine,
    *,
    playbook_id: int, playbook_version: int, cancel_attempt_id: int,
    succeeded: bool, failure_step: str | None, failure_reason: str | None,
    duration_ms: int, client_version: str,
) -> PlaybookRun:
    run = PlaybookRun(
        playbook_id=playbook_id, playbook_version=playbook_version,
        cancel_attempt_id=cancel_attempt_id, succeeded=succeeded,
        failure_step=failure_step, failure_reason=failure_reason,
        duration_ms=duration_ms, ran_at=datetime.now(),
        client_version=client_version, contributed_back=False,
    )
    with Session(engine) as s:
        s.add(run); s.commit(); s.refresh(run)
    return run
```

- [ ] **Step 4: Create `agent.py`**

```python
# src/blackmamba/core/unsubscribe/agent.py
import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional, Protocol
from sqlmodel import Session
from sqlalchemy.engine import Engine
from ..models import Subscription
from .selector import select_playbook
from .outcome import detect_outcome, Outcome
from .recorder import record_attempt, record_playbook_run

@dataclass
class UnsubscribeRequest:
    subscription_id: int
    region: str
    screenshot_dir: Path
    client_version: str

class BrowserAgent(Protocol):
    async def run(
        self, goal: str, start_url: str, selectors: dict, screenshot_dir: Path,
    ) -> dict:
        """Drive a browser to satisfy the goal. Returns:
        {ok: bool, final_text: str, screenshots: list[str], transcript: list[dict]}.
        """
        ...

GOAL_TEMPLATE = """\
Cancel my subscription to {merchant}. Steps may help:
{steps}

If you encounter login, 2FA, CAPTCHA, or any 'are you sure?' confirmation
to actually cancel, complete the confirmation. If the page offers to pause,
downgrade, or switch to a free tier, do NOT accept — stop and report back.
"""

async def run_unsubscribe(
    req: UnsubscribeRequest, engine: Engine, browser: BrowserAgent,
) -> "CancelAttempt":
    started = datetime.now()
    with Session(engine) as s:
        sub = s.get(Subscription, req.subscription_id)
        if sub is None:
            raise ValueError(f"subscription {req.subscription_id} not found")
        sub_merchant = sub.merchant
        sub_canonical = sub.canonical_name
        sub_cancel_url = sub.cancel_url

    pb = select_playbook(sub_canonical, region=req.region, engine=engine)
    if pb is not None:
        steps = pb.steps_text
        selectors = json.loads(pb.selectors_json or "{}")
        start_url = pb.cancel_url
        playbook_id, playbook_version = pb.id, pb.version
    else:
        steps = "(no playbook — figure it out)"
        selectors = {}
        start_url = sub_cancel_url or f"https://www.google.com/search?q=cancel+{sub_merchant}"
        playbook_id, playbook_version = None, None

    goal = GOAL_TEMPLATE.format(merchant=sub_merchant, steps=steps)
    result = await browser.run(
        goal=goal, start_url=start_url, selectors=selectors,
        screenshot_dir=req.screenshot_dir,
    )

    outcome = detect_outcome(result.get("final_text", ""))
    if not result.get("ok", False) and outcome == Outcome.unknown:
        outcome = Outcome.needs_human

    ended = datetime.now()
    att = record_attempt(
        engine,
        subscription_id=req.subscription_id, started_at=started, ended_at=ended,
        outcome=outcome.value, playbook_id=playbook_id, playbook_version=playbook_version,
        transcript=result.get("transcript", []),
        screenshots=result.get("screenshots", []),
    )

    if outcome == Outcome.success:
        with Session(engine) as s:
            sub = s.get(Subscription, req.subscription_id)
            sub.status = "canceled"
            s.commit()

    if playbook_id is not None:
        record_playbook_run(
            engine,
            playbook_id=playbook_id, playbook_version=playbook_version,
            cancel_attempt_id=att.id, succeeded=(outcome == Outcome.success),
            failure_step=None,
            failure_reason=None if outcome == Outcome.success else outcome.value,
            duration_ms=int((ended - started).total_seconds() * 1000),
            client_version=req.client_version,
        )
    return att
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest tests/test_unsubscribe_agent.py -v`
Expected: 3 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/blackmamba/core/unsubscribe/agent.py src/blackmamba/core/unsubscribe/recorder.py tests/test_unsubscribe_agent.py
git commit -m "feat(unsubscribe): orchestrator over BrowserAgent + recording"
```

---

## Task 7: Real browser-use adapter

**Files:**
- Create: `src/blackmamba/core/unsubscribe/browser_use_adapter.py`

This wraps the real `browser-use` library to satisfy the `BrowserAgent` protocol. No automated tests — `browser-use` is exercised in the Task 8 dogfood run.

- [ ] **Step 1: Add browser-use to deps**

Modify `pyproject.toml` — add `"browser-use>=0.1"` to `dependencies`. Run `uv pip install -e ".[dev]"` and `uv run playwright install chromium`.

- [ ] **Step 2: Create the adapter**

```python
# src/blackmamba/core/unsubscribe/browser_use_adapter.py
import os
from pathlib import Path
from typing import Optional

class BrowserUseAdapter:
    """Adapter satisfying BrowserAgent. Uses browser-use to drive Playwright.

    `use_user_profile=True` launches Chrome with the user's existing profile
    so cookies and 2FA sessions are reused (spec section 'C as default')."""

    def __init__(
        self,
        llm_model: str = "anthropic/claude-opus-4-7",
        use_user_profile: bool = True,
        chrome_executable_path: Optional[str] = None,
        chrome_user_data_dir: Optional[str] = None,
    ):
        self._llm_model = llm_model
        self._use_user_profile = use_user_profile
        self._chrome_executable_path = chrome_executable_path or os.environ.get(
            "BLACKMAMBA_CHROME_PATH"
        )
        self._chrome_user_data_dir = chrome_user_data_dir or os.environ.get(
            "BLACKMAMBA_CHROME_USER_DATA_DIR"
        )

    async def run(self, goal: str, start_url: str, selectors: dict,
                  screenshot_dir: Path) -> dict:
        from browser_use import Agent, Browser, BrowserConfig
        screenshot_dir = Path(screenshot_dir)
        screenshot_dir.mkdir(parents=True, exist_ok=True)

        browser_cfg = BrowserConfig(
            headless=False,
            chrome_instance_path=self._chrome_executable_path if self._use_user_profile else None,
        )
        browser = Browser(config=browser_cfg)
        try:
            full_goal = (
                f"Go to {start_url}. {goal}\n\n"
                f"Suggested selectors (use if present, fall back to vision if not): {selectors}"
            )
            agent = Agent(task=full_goal, llm=self._llm_model, browser=browser)
            history = await agent.run()
            final_text = ""
            try:
                final_text = await agent.page.inner_text("body")
            except Exception:
                pass
            shots: list[str] = []
            try:
                shot = screenshot_dir / "final.png"
                await agent.page.screenshot(path=str(shot), full_page=True)
                shots.append(str(shot))
            except Exception:
                pass
            transcript = [
                {"step": step.action, "url": getattr(step, "url", None)}
                for step in getattr(history, "steps", [])
            ]
            return {
                "ok": True,
                "final_text": final_text,
                "screenshots": shots,
                "transcript": transcript,
            }
        except Exception as e:
            return {
                "ok": False, "final_text": "",
                "screenshots": [], "transcript": [{"error": str(e)}],
            }
        finally:
            await browser.close()
```

> **Note:** `browser-use`'s API has evolved. If the import or class names above don't match the installed version, fix them per the installed library's docs — the contract this adapter satisfies (returning `{ok, final_text, screenshots, transcript}`) is what the rest of the system relies on.

- [ ] **Step 3: Verify import**

Run: `uv run python -c "from blackmamba.core.unsubscribe.browser_use_adapter import BrowserUseAdapter; print('ok')"`
Expected: `ok` (or an ImportError if browser-use's API has drifted — fix imports per their docs, then retry).

- [ ] **Step 4: Commit**

```bash
git add pyproject.toml src/blackmamba/core/unsubscribe/browser_use_adapter.py
git commit -m "feat(unsubscribe): browser-use adapter (real-browser path)"
```

---

## Task 8: TUI cancel screen + binding

**Files:**
- Create: `src/blackmamba/tui/screens/cancel.py`
- Modify: `src/blackmamba/tui/screens/subscriptions.py`, `src/blackmamba/tui/app.py`

No automated tests — dogfood-only.

- [ ] **Step 1: Create the cancel screen**

```python
# src/blackmamba/tui/screens/cancel.py
import asyncio
from pathlib import Path
from textual.app import ComposeResult
from textual.containers import Vertical, Horizontal
from textual.screen import Screen
from textual.widgets import Header, Footer, Static, Log
from sqlalchemy.engine import Engine
from blackmamba.core.unsubscribe.agent import run_unsubscribe, UnsubscribeRequest, BrowserAgent

class CancelScreen(Screen):
    BINDINGS = [("escape", "back", "Back"), ("a", "abort", "Abort run")]

    def __init__(self, engine: Engine, browser: BrowserAgent,
                 subscription_id: int, merchant: str,
                 screenshot_dir: Path, client_version: str):
        super().__init__()
        self._engine = engine
        self._browser = browser
        self._subscription_id = subscription_id
        self._merchant = merchant
        self._screenshot_dir = screenshot_dir
        self._client_version = client_version
        self._task: asyncio.Task | None = None

    def compose(self) -> ComposeResult:
        yield Header(show_clock=False)
        yield Vertical(
            Static(f"Canceling: {self._merchant}", id="merchant"),
            Static("Starting…", id="status"),
            Log(id="log", highlight=True),
        )
        yield Footer()

    async def on_mount(self) -> None:
        log = self.query_one("#log", Log)
        status = self.query_one("#status", Static)
        log.write_line(f"Subscription id {self._subscription_id}")
        async def _go():
            req = UnsubscribeRequest(
                subscription_id=self._subscription_id,
                region="any",
                screenshot_dir=self._screenshot_dir,
                client_version=self._client_version,
            )
            try:
                att = await run_unsubscribe(req, self._engine, self._browser)
                status.update(f"Outcome: {att.outcome}")
                log.write_line(f"Done. outcome={att.outcome}, attempt_id={att.id}")
            except Exception as e:
                status.update(f"Error: {e}")
                log.write_line(f"Error: {e}")
        self._task = asyncio.create_task(_go())

    def action_back(self) -> None:
        self.app.pop_screen()

    def action_abort(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
            self.query_one("#status", Static).update("Aborted by user")
```

- [ ] **Step 2: Wire the cancel binding into the subscriptions screen**

Edit `src/blackmamba/tui/screens/subscriptions.py`:

```python
# add to BINDINGS list:
BINDINGS = [("r", "refresh", "Refresh"), ("c", "cancel", "Cancel selected"),
            ("q", "quit", "Quit")]

# add a method (inside SubscriptionsScreen):
def action_cancel(self) -> None:
    t = self.query_one("#subs", DataTable)
    if t.cursor_row is None:
        return
    row_key = t.coordinate_to_cell_key((t.cursor_row, 0)).row_key
    sub_id = int(row_key.value)
    merchant = t.get_cell_at((t.cursor_row, 0))
    self.app.open_cancel_screen(sub_id, merchant)
```

And ensure each `add_row` carries the subscription id as the row key:

```python
# inside refresh_table loop, change add_row to:
t.add_row(r.merchant, r.cadence,
          f"{r.amount:.2f} {r.currency or ''}" if r.amount else "-",
          r.necessity, f"{r.confidence:.2f}",
          r.trial_ends_at.date().isoformat() if r.trial_ends_at else "-",
          key=str(r.id))
```

- [ ] **Step 3: Wire the browser adapter and screen launcher into the app**

Edit `src/blackmamba/tui/app.py`:

```python
# At top, add:
from pathlib import Path
from blackmamba.core.unsubscribe.browser_use_adapter import BrowserUseAdapter
from blackmamba.tui.screens.cancel import CancelScreen
from blackmamba import __version__ as _VERSION

# In BlackMambaApp.__init__ signature, add:
#   browser: BrowserAgent, screenshot_dir: Path
# Persist them as self._browser, self._screenshot_dir.

# Add method:
def open_cancel_screen(self, subscription_id: int, merchant: str) -> None:
    self.push_screen(CancelScreen(
        engine=self._engine, browser=self._browser,
        subscription_id=subscription_id, merchant=merchant,
        screenshot_dir=self._screenshot_dir, client_version=_VERSION,
    ))

# In main():
screenshot_dir = Path(os.environ.get(
    "BLACKMAMBA_SHOTS_DIR", "~/.blackmamba/shots")).expanduser()
browser = BrowserUseAdapter()
BlackMambaApp(engine=engine, gmail_factory=gmail_factory, llm=llm,
              browser=browser, screenshot_dir=screenshot_dir).run()
```

- [ ] **Step 4: Verify imports**

Run: `uv run python -c "from blackmamba.tui.app import BlackMambaApp; print('ok')"`
Expected: `ok`.

- [ ] **Step 5: Run the test suite**

Run: `uv run pytest -v`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/blackmamba/tui/screens/cancel.py src/blackmamba/tui/screens/subscriptions.py src/blackmamba/tui/app.py
git commit -m "feat(tui): cancel screen wired to unsubscribe agent"
```

---

## Task 9: Playbook bootstrap on app start

**Files:**
- Modify: `src/blackmamba/tui/app.py`, `.env.example`

- [ ] **Step 1: Bootstrap from env-configured repo**

Edit `src/blackmamba/tui/app.py` `main()`:

```python
# After init_db(engine), before constructing the App:
from blackmamba.core.unsubscribe.cache import sync_playbooks_from_git
playbook_repo = os.environ.get("BLACKMAMBA_PLAYBOOK_REPO")
playbook_local = Path(os.environ.get(
    "BLACKMAMBA_PLAYBOOK_LOCAL", "~/.blackmamba/playbooks")).expanduser()
if playbook_repo:
    try:
        sync_playbooks_from_git(playbook_repo, playbook_local, engine)
    except Exception as e:
        print(f"Warning: playbook sync failed: {e}")
```

- [ ] **Step 2: Document env vars**

Append to `.env.example`:

```
BLACKMAMBA_PLAYBOOK_REPO=https://github.com/<org>/blackmamba-playbooks
BLACKMAMBA_PLAYBOOK_LOCAL=~/.blackmamba/playbooks
BLACKMAMBA_SHOTS_DIR=~/.blackmamba/shots
BLACKMAMBA_CHROME_PATH=
BLACKMAMBA_CHROME_USER_DATA_DIR=
```

- [ ] **Step 3: Commit**

```bash
git add src/blackmamba/tui/app.py .env.example
git commit -m "feat(tui): sync playbooks from configured git repo on launch"
```

---

## Task 10: Dogfood end-to-end

Manual — no automated tests.

- [ ] **Step 1: Run the test suite**

Run: `uv run pytest -v`
Expected: all green.

- [ ] **Step 2: Set up the playbooks repo**

Create a public GitHub repo `blackmamba-playbooks` with a `playbooks/` directory. Copy `tests/fixtures/playbooks/netflix.yaml` in as a starting playbook. Set `BLACKMAMBA_PLAYBOOK_REPO` in `.env`.

- [ ] **Step 3: Launch TUI**

Run: `uv run blackmamba`
- Verify playbook sync log line appears.
- Press `s` to refresh subscriptions (from Plan 1).
- Move cursor to a row with a known cancellation flow (start with Netflix or another sub you actually want to cancel).
- Press `c` to launch the cancel screen.
- Watch the launched Chrome window. Intervene at 2FA/login as needed.

- [ ] **Step 4: Verify outcome**

After the run, press `r` in the subscriptions screen — `status` should be `canceled` for successful runs. Inspect `~/.blackmamba/shots/` for the final screenshot.

- [ ] **Step 5: File issues for any failure**

For each cancellation attempt that ended in `needs_human` or `ambiguous` when it shouldn't have, file an issue with: merchant, playbook version (if any), final screenshot, transcript dump. These drive Plan 2's iteration loop and the playbook repo's growth.

---

## Self-review notes

- Spec §2 (in-scope: user-triggered cancellation, browser-use, shared playbook repo) — covered by Tasks 1-10.
- Spec §5 (`unsubscribe agent` row) — Task 6 handles selection + agent path branching (no playbook / plaintext / plaintext+selectors). Both fully-scripted and pure-LLM modes share the same `BrowserAgent` interface; routing differs only in whether `selectors` is empty.
- Spec §6 — `Playbook`, `CancelAttempt`, `PlaybookRun` tables created in Task 2; column names match `cancel_attempt.outcome ∈ {success, failed, needs_human, manual, aborted}` from the spec.
- Spec §7 Journey B (lookup → branch on richness → browser launch decision → run → verify → record) — covered by Task 6.
- Spec §9 failure modes for unsubscribe (login wall, 2FA, retention dark patterns) — outcome heuristics in Task 5 catch `paused`/`downgrade` as `ambiguous` so the sub stays active. Login walls surface as adapter exceptions → `ok=False` → `needs_human`.
- Browser launch path B (fresh + keychain creds) and explicit per-run user choice between A/B/C are deferred; v1 uses C by default per the spec's recommendation.
- Telemetry contribution-back upstream (spec open question §11) is also deferred: `playbook_run.contributed_back` exists, no shipping mechanism yet.
