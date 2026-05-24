# BlackMamba — Plan 3: Bank Statement Ingest + Reconcile

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** User uploads a CSV bank statement from the TUI. The system maps unfamiliar columns once (saved per bank), parses charges, reconciles them against Gmail-derived subscriptions, and improves trial detection with two signals: (a) Gmail signup with no matching bank charge yet; (b) tiny verify charges ($0.01 or $1) that immediately precede a real subscription.

**Architecture:** Adds `bank_charge` and `csv_mapping` tables and a `core/statement/` subpackage. The ingestor reads a CSV, applies a per-bank column mapping, and writes normalized `BankCharge` rows. A reconciler joins charges to subscriptions on (canonical merchant, amount tolerance) and updates `subscription.cadence` / `next_charge_at` / `confidence`. The trial detector promotes Gmail-only signups to `cadence=trial` and flags verify charges. TUI gets an "Upload statement" action.

**Tech Stack:** Same as Plans 1+2. Adds `pandas>=2` for CSV parsing (handles weird dialects better than the stdlib `csv` module).

**Depends on:** Plan 1 (core package, models, TUI shell). Independent of Plan 2.

---

## File Structure (additions)

```
src/blackmamba/core/statement/
  __init__.py
  schema.py              # ChargeRow pydantic model (post-mapping)
  csv_parser.py          # read CSV → list[ChargeRow] given a mapping
  mapping.py             # save/load CsvMapping per bank
  ingestor.py            # write BankCharge rows (idempotent)
  reconcile.py           # join bank charges to subscriptions
  trial_signal.py        # verify-charge + missing-charge heuristics

src/blackmamba/tui/screens/
  upload.py              # statement upload + column-mapping wizard

tests/
  test_statement_csv_parser.py
  test_statement_mapping.py
  test_statement_ingestor.py
  test_statement_reconcile.py
  test_statement_trial_signal.py
  fixtures/statements/
    chase_sample.csv
    amex_sample.csv
```

Plus changes to existing files:
- `src/blackmamba/core/models.py` — add `BankCharge` and `CsvMapping`.
- `src/blackmamba/tui/screens/subscriptions.py` — add `u` binding for upload.
- `src/blackmamba/tui/app.py` — register upload screen factory.

---

## Task 1: BankCharge + CsvMapping tables

**Files:**
- Modify: `src/blackmamba/core/models.py`
- Test: `tests/test_models_statement.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_models_statement.py
from datetime import datetime, date
from sqlmodel import Session, select
from sqlalchemy.exc import IntegrityError
from blackmamba.core.db import get_engine, init_db
from blackmamba.core.models import BankCharge, CsvMapping

def test_bank_charge_roundtrip(tmp_path):
    engine = get_engine(str(tmp_path / "t.db")); init_db(engine)
    with Session(engine) as s:
        c = BankCharge(source_file="chase.csv", external_id="chase:2026-01-01:netflix:15.99",
                       posted_at=date(2026, 1, 1), merchant_raw="NETFLIX.COM",
                       canonical_name="netflix", amount=15.99, currency="USD",
                       imported_at=datetime.now())
        s.add(c); s.commit(); s.refresh(c)
        assert c.id is not None

def test_bank_charge_idempotent_on_external_id(tmp_path):
    engine = get_engine(str(tmp_path / "t.db")); init_db(engine)
    with Session(engine) as s:
        s.add(BankCharge(source_file="a.csv", external_id="x",
                         posted_at=date(2026,1,1), merchant_raw="m",
                         canonical_name="m", amount=1.0, currency="USD",
                         imported_at=datetime.now()))
        s.commit()
    with Session(engine) as s:
        s.add(BankCharge(source_file="a.csv", external_id="x",
                         posted_at=date(2026,1,1), merchant_raw="m",
                         canonical_name="m", amount=1.0, currency="USD",
                         imported_at=datetime.now()))
        try:
            s.commit()
            raise AssertionError("expected IntegrityError")
        except IntegrityError:
            pass

def test_csv_mapping_roundtrip(tmp_path):
    engine = get_engine(str(tmp_path / "t.db")); init_db(engine)
    with Session(engine) as s:
        m = CsvMapping(bank_key="chase", header_fingerprint="date,desc,amount",
                       mapping_json='{"date":"date","merchant":"desc","amount":"amount"}',
                       updated_at=datetime.now())
        s.add(m); s.commit(); s.refresh(m)
        assert m.id is not None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_models_statement.py -v`
Expected: ImportError.

- [ ] **Step 3: Append to `models.py`**

```python
class BankCharge(SQLModel, table=True):
    __tablename__ = "bank_charge"
    __table_args__ = (UniqueConstraint("external_id"),)
    id: Optional[int] = Field(default=None, primary_key=True)
    source_file: str
    external_id: str
    posted_at: "date"  # type imported at top of file
    merchant_raw: str
    canonical_name: str = Field(index=True)
    amount: float
    currency: str = "USD"
    subscription_id: Optional[int] = Field(default=None, foreign_key="subscription.id")
    is_trial_verify: bool = False
    imported_at: datetime

class CsvMapping(SQLModel, table=True):
    __tablename__ = "csv_mapping"
    id: Optional[int] = Field(default=None, primary_key=True)
    bank_key: str = Field(index=True)
    header_fingerprint: str = Field(index=True)  # comma-joined sorted headers
    mapping_json: str  # JSON of {logical_field: csv_header}
    updated_at: datetime
```

Also add `from datetime import date` to the imports at the top of `models.py`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_models_statement.py -v`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blackmamba/core/models.py tests/test_models_statement.py
git commit -m "feat(statement): bank_charge and csv_mapping tables"
```

---

## Task 2: ChargeRow schema + sample fixtures

**Files:**
- Create: `src/blackmamba/core/statement/__init__.py`, `src/blackmamba/core/statement/schema.py`, `tests/fixtures/statements/chase_sample.csv`, `tests/fixtures/statements/amex_sample.csv`
- Test: `tests/test_statement_schema.py`

- [ ] **Step 1: Create sample CSVs**

```csv
# tests/fixtures/statements/chase_sample.csv
Transaction Date,Post Date,Description,Category,Type,Amount,Memo
01/02/2026,01/02/2026,NETFLIX.COM 866-579-7172 CA,Entertainment,Sale,-15.99,
01/03/2026,01/03/2026,SPOTIFY USA  NEW YORK NY,Entertainment,Sale,-9.99,
01/04/2026,01/04/2026,STARBUCKS STORE 1234,Food,Sale,-5.25,
01/05/2026,01/05/2026,OPENAI*CHATGPT 0.01,Services,Sale,-0.01,
```

```csv
# tests/fixtures/statements/amex_sample.csv
Date,Description,Card Member,Account #,Amount
01/06/2026,NETFLIX.COM,JOHN DOE,12345,15.99
01/07/2026,SPOTIFY,JOHN DOE,12345,9.99
```

- [ ] **Step 2: Write failing tests**

```python
# tests/test_statement_schema.py
from datetime import date
import pytest
from pydantic import ValidationError
from blackmamba.core.statement.schema import ChargeRow

def test_charge_row_valid():
    r = ChargeRow(posted_at=date(2026,1,2), merchant_raw="NETFLIX.COM",
                  amount=15.99, currency="USD")
    assert r.amount == 15.99

def test_charge_row_rejects_zero_amount():
    with pytest.raises(ValidationError):
        ChargeRow(posted_at=date(2026,1,2), merchant_raw="X",
                  amount=0.0, currency="USD")

def test_charge_row_amount_must_be_positive_after_normalization():
    # convention: negative-sign amounts in source CSV are *debits* and we
    # invert them at the parser, so by the time we reach ChargeRow they're +.
    with pytest.raises(ValidationError):
        ChargeRow(posted_at=date(2026,1,2), merchant_raw="X",
                  amount=-5.0, currency="USD")
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `uv run pytest tests/test_statement_schema.py -v`
Expected: ImportError.

- [ ] **Step 4: Create `schema.py`**

```python
# src/blackmamba/core/statement/__init__.py
```

```python
# src/blackmamba/core/statement/schema.py
from datetime import date as _date
from pydantic import BaseModel, Field

class ChargeRow(BaseModel):
    posted_at: _date
    merchant_raw: str = Field(min_length=1)
    amount: float = Field(gt=0)
    currency: str = "USD"
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest tests/test_statement_schema.py -v`
Expected: 3 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/blackmamba/core/statement/__init__.py src/blackmamba/core/statement/schema.py tests/test_statement_schema.py tests/fixtures/statements/chase_sample.csv tests/fixtures/statements/amex_sample.csv
git commit -m "feat(statement): ChargeRow schema and sample CSV fixtures"
```

---

## Task 3: CSV mapping (save/load per bank)

**Files:**
- Create: `src/blackmamba/core/statement/mapping.py`
- Test: `tests/test_statement_mapping.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_statement_mapping.py
from datetime import datetime
from blackmamba.core.db import get_engine, init_db
from blackmamba.core.statement.mapping import (
    CsvFieldMap, fingerprint_headers, save_mapping, load_mapping_by_fingerprint,
)

def test_fingerprint_is_order_independent():
    a = fingerprint_headers(["Date", "Description", "Amount"])
    b = fingerprint_headers(["Amount", "Date", "Description"])
    assert a == b

def test_fingerprint_is_case_insensitive_and_trimmed():
    a = fingerprint_headers(["date", "Description ", "AMOUNT"])
    b = fingerprint_headers(["Date", "description", "Amount"])
    assert a == b

def test_save_and_load_mapping(tmp_path):
    engine = get_engine(str(tmp_path / "t.db")); init_db(engine)
    headers = ["Date", "Description", "Amount"]
    m = CsvFieldMap(date="Date", merchant="Description", amount="Amount")
    save_mapping(bank_key="generic", headers=headers, mapping=m, engine=engine)
    loaded = load_mapping_by_fingerprint(headers, engine)
    assert loaded is not None
    assert loaded.merchant == "Description"

def test_load_returns_none_when_unknown(tmp_path):
    engine = get_engine(str(tmp_path / "t.db")); init_db(engine)
    assert load_mapping_by_fingerprint(["A", "B"], engine) is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_statement_mapping.py -v`
Expected: ImportError.

- [ ] **Step 3: Create `mapping.py`**

```python
# src/blackmamba/core/statement/mapping.py
import json
from dataclasses import dataclass
from datetime import datetime
from typing import Iterable, Optional
from sqlmodel import Session, select
from sqlalchemy.engine import Engine
from ..models import CsvMapping

@dataclass
class CsvFieldMap:
    date: str         # CSV header for posted/transaction date
    merchant: str     # CSV header for merchant description
    amount: str       # CSV header for amount (signed or unsigned)
    currency: Optional[str] = None  # optional CSV header
    amount_sign: str = "negative_is_debit"  # or "positive_is_debit"

def fingerprint_headers(headers: Iterable[str]) -> str:
    return ",".join(sorted(h.strip().lower() for h in headers))

def save_mapping(*, bank_key: str, headers: Iterable[str],
                 mapping: CsvFieldMap, engine: Engine) -> None:
    fp = fingerprint_headers(headers)
    payload = json.dumps({
        "date": mapping.date, "merchant": mapping.merchant,
        "amount": mapping.amount, "currency": mapping.currency,
        "amount_sign": mapping.amount_sign,
    })
    with Session(engine) as s:
        existing = s.exec(
            select(CsvMapping).where(CsvMapping.header_fingerprint == fp)
        ).first()
        if existing:
            existing.bank_key = bank_key
            existing.mapping_json = payload
            existing.updated_at = datetime.now()
        else:
            s.add(CsvMapping(bank_key=bank_key, header_fingerprint=fp,
                             mapping_json=payload, updated_at=datetime.now()))
        s.commit()

def load_mapping_by_fingerprint(headers: Iterable[str], engine: Engine) -> Optional[CsvFieldMap]:
    fp = fingerprint_headers(headers)
    with Session(engine) as s:
        row = s.exec(select(CsvMapping).where(CsvMapping.header_fingerprint == fp)).first()
        if not row:
            return None
        d = json.loads(row.mapping_json)
        return CsvFieldMap(
            date=d["date"], merchant=d["merchant"], amount=d["amount"],
            currency=d.get("currency"), amount_sign=d.get("amount_sign", "negative_is_debit"),
        )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_statement_mapping.py -v`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blackmamba/core/statement/mapping.py tests/test_statement_mapping.py
git commit -m "feat(statement): per-bank CSV column mapping with header fingerprint"
```

---

## Task 4: CSV parser

**Files:**
- Create: `src/blackmamba/core/statement/csv_parser.py`
- Test: `tests/test_statement_csv_parser.py`

- [ ] **Step 1: Add pandas to deps**

Modify `pyproject.toml` — add `"pandas>=2"` to `dependencies`. Run `uv pip install -e ".[dev]"`.

- [ ] **Step 2: Write failing tests**

```python
# tests/test_statement_csv_parser.py
from datetime import date
from pathlib import Path
from blackmamba.core.statement.mapping import CsvFieldMap
from blackmamba.core.statement.csv_parser import (
    read_headers, parse_csv,
)

FIX = Path(__file__).parent / "fixtures" / "statements"

def test_read_headers_chase():
    h = read_headers(FIX / "chase_sample.csv")
    assert "Description" in h
    assert "Amount" in h

def test_parse_chase_with_mapping():
    mapping = CsvFieldMap(date="Transaction Date", merchant="Description",
                          amount="Amount", amount_sign="negative_is_debit")
    rows = parse_csv(FIX / "chase_sample.csv", mapping)
    assert len(rows) == 4
    assert rows[0].posted_at == date(2026, 1, 2)
    assert rows[0].merchant_raw == "NETFLIX.COM 866-579-7172 CA"
    assert rows[0].amount == 15.99  # inverted from -15.99

def test_parse_amex_with_positive_debits():
    mapping = CsvFieldMap(date="Date", merchant="Description",
                          amount="Amount", amount_sign="positive_is_debit")
    rows = parse_csv(FIX / "amex_sample.csv", mapping)
    assert len(rows) == 2
    assert rows[0].amount == 15.99
    assert rows[1].merchant_raw == "SPOTIFY"

def test_parse_skips_credits():
    # If amount_sign='negative_is_debit', positive rows are credits and skipped.
    mapping = CsvFieldMap(date="Transaction Date", merchant="Description",
                          amount="Amount", amount_sign="negative_is_debit")
    rows = parse_csv(FIX / "chase_sample.csv", mapping)
    assert all(r.amount > 0 for r in rows)
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `uv run pytest tests/test_statement_csv_parser.py -v`
Expected: ImportError.

- [ ] **Step 4: Create `csv_parser.py`**

```python
# src/blackmamba/core/statement/csv_parser.py
from datetime import datetime, date as _date
from pathlib import Path
from typing import Iterable
import pandas as pd
from .schema import ChargeRow
from .mapping import CsvFieldMap

DATE_FORMATS = ("%m/%d/%Y", "%Y-%m-%d", "%d/%m/%Y", "%m-%d-%Y")

def read_headers(path: Path) -> list[str]:
    return list(pd.read_csv(path, nrows=0).columns)

def _parse_date(s: str) -> _date:
    s = (s or "").strip()
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"unrecognized date format: {s!r}")

def parse_csv(path: Path, mapping: CsvFieldMap) -> list[ChargeRow]:
    df = pd.read_csv(path, dtype=str).fillna("")
    rows: list[ChargeRow] = []
    for _, r in df.iterrows():
        try:
            raw_amount = float(str(r[mapping.amount]).replace(",", "").replace("$", ""))
        except (ValueError, KeyError):
            continue
        if mapping.amount_sign == "negative_is_debit":
            if raw_amount >= 0:
                continue  # credit, skip
            amount = -raw_amount
        else:  # positive_is_debit
            if raw_amount <= 0:
                continue
            amount = raw_amount
        try:
            posted = _parse_date(r[mapping.date])
        except (ValueError, KeyError):
            continue
        merchant = str(r[mapping.merchant]).strip()
        if not merchant:
            continue
        currency = "USD"
        if mapping.currency and mapping.currency in df.columns:
            cv = str(r[mapping.currency]).strip()
            if cv:
                currency = cv
        rows.append(ChargeRow(posted_at=posted, merchant_raw=merchant,
                              amount=round(amount, 2), currency=currency))
    return rows
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest tests/test_statement_csv_parser.py -v`
Expected: 4 PASS.

- [ ] **Step 6: Commit**

```bash
git add pyproject.toml src/blackmamba/core/statement/csv_parser.py tests/test_statement_csv_parser.py
git commit -m "feat(statement): CSV parser with date and amount-sign handling"
```

---

## Task 5: Statement ingestor (write BankCharge rows)

**Files:**
- Create: `src/blackmamba/core/statement/ingestor.py`
- Test: `tests/test_statement_ingestor.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_statement_ingestor.py
from datetime import date, datetime
from pathlib import Path
from sqlmodel import Session, select
from blackmamba.core.db import get_engine, init_db
from blackmamba.core.models import BankCharge
from blackmamba.core.statement.mapping import CsvFieldMap
from blackmamba.core.statement.ingestor import ingest_statement

FIX = Path(__file__).parent / "fixtures" / "statements"

def test_ingest_chase(tmp_path):
    engine = get_engine(str(tmp_path / "t.db")); init_db(engine)
    mapping = CsvFieldMap(date="Transaction Date", merchant="Description",
                          amount="Amount", amount_sign="negative_is_debit")
    n = ingest_statement(FIX / "chase_sample.csv", mapping, engine)
    assert n == 4
    with Session(engine) as s:
        rows = s.exec(select(BankCharge)).all()
        assert len(rows) == 4
        assert any(r.canonical_name == "netflix" for r in rows)
        assert any(r.amount == 0.01 for r in rows)

def test_ingest_is_idempotent(tmp_path):
    engine = get_engine(str(tmp_path / "t.db")); init_db(engine)
    mapping = CsvFieldMap(date="Transaction Date", merchant="Description",
                          amount="Amount", amount_sign="negative_is_debit")
    ingest_statement(FIX / "chase_sample.csv", mapping, engine)
    n2 = ingest_statement(FIX / "chase_sample.csv", mapping, engine)
    assert n2 == 0
    with Session(engine) as s:
        assert len(s.exec(select(BankCharge)).all()) == 4
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_statement_ingestor.py -v`
Expected: ImportError.

- [ ] **Step 3: Create `ingestor.py`**

```python
# src/blackmamba/core/statement/ingestor.py
import hashlib
from datetime import datetime
from pathlib import Path
from sqlmodel import Session, select
from sqlalchemy.engine import Engine
from ..models import BankCharge
from ..detect import canonicalize
from .csv_parser import parse_csv
from .mapping import CsvFieldMap

def _external_id(source_file: str, charge) -> str:
    raw = f"{source_file}|{charge.posted_at.isoformat()}|{charge.merchant_raw}|{charge.amount:.2f}"
    return hashlib.sha256(raw.encode()).hexdigest()[:24]

def ingest_statement(path: Path, mapping: CsvFieldMap, engine: Engine) -> int:
    path = Path(path)
    rows = parse_csv(path, mapping)
    inserted = 0
    with Session(engine) as s:
        existing = {r for r, in s.exec(
            select(BankCharge.external_id).where(BankCharge.source_file == path.name)
        )}
        for r in rows:
            ext = _external_id(path.name, r)
            if ext in existing:
                continue
            s.add(BankCharge(
                source_file=path.name, external_id=ext, posted_at=r.posted_at,
                merchant_raw=r.merchant_raw, canonical_name=canonicalize(r.merchant_raw),
                amount=r.amount, currency=r.currency, imported_at=datetime.now(),
            ))
            inserted += 1
        s.commit()
    return inserted
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_statement_ingestor.py -v`
Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blackmamba/core/statement/ingestor.py tests/test_statement_ingestor.py
git commit -m "feat(statement): ingestor writes idempotent BankCharge rows"
```

---

## Task 6: Reconcile bank charges with subscriptions

**Files:**
- Create: `src/blackmamba/core/statement/reconcile.py`
- Test: `tests/test_statement_reconcile.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_statement_reconcile.py
from datetime import date, datetime, timedelta
from sqlmodel import Session, select
from blackmamba.core.db import get_engine, init_db
from blackmamba.core.models import Subscription, BankCharge
from blackmamba.core.statement.reconcile import reconcile_charges

def _seed_sub(s, **overrides):
    base = dict(merchant="Netflix", canonical_name="netflix",
                cadence="unknown", amount=15.99, currency="USD",
                status="active", necessity="unknown", necessity_source="llm",
                confidence=0.5,
                first_seen_at=datetime.now(), last_seen_at=datetime.now())
    base.update(overrides); s.add(Subscription(**base))

def _seed_charge(s, **overrides):
    base = dict(source_file="x.csv", external_id="x",
                posted_at=date(2026,1,1), merchant_raw="NETFLIX.COM",
                canonical_name="netflix", amount=15.99, currency="USD",
                imported_at=datetime.now())
    base.update(overrides); s.add(BankCharge(**base))

def test_reconcile_links_charge_to_subscription(tmp_path):
    engine = get_engine(str(tmp_path / "t.db")); init_db(engine)
    with Session(engine) as s:
        _seed_sub(s); _seed_charge(s); s.commit()
    n = reconcile_charges(engine)
    assert n == 1
    with Session(engine) as s:
        c = s.exec(select(BankCharge)).first()
        assert c.subscription_id is not None

def test_reconcile_promotes_cadence_when_two_charges_one_month_apart(tmp_path):
    engine = get_engine(str(tmp_path / "t.db")); init_db(engine)
    with Session(engine) as s:
        _seed_sub(s)
        _seed_charge(s, external_id="c1", posted_at=date(2026,1,2))
        _seed_charge(s, external_id="c2", posted_at=date(2026,2,2))
        s.commit()
    reconcile_charges(engine)
    with Session(engine) as s:
        sub = s.exec(select(Subscription)).first()
        assert sub.cadence == "monthly"

def test_reconcile_amount_tolerance(tmp_path):
    engine = get_engine(str(tmp_path / "t.db")); init_db(engine)
    with Session(engine) as s:
        _seed_sub(s, amount=15.99)
        _seed_charge(s, amount=16.99)  # tax bump within ±$2 tolerance
        s.commit()
    reconcile_charges(engine)
    with Session(engine) as s:
        c = s.exec(select(BankCharge)).first()
        assert c.subscription_id is not None

def test_reconcile_rejects_far_amount(tmp_path):
    engine = get_engine(str(tmp_path / "t.db")); init_db(engine)
    with Session(engine) as s:
        _seed_sub(s, amount=15.99)
        _seed_charge(s, amount=199.00)
        s.commit()
    reconcile_charges(engine)
    with Session(engine) as s:
        c = s.exec(select(BankCharge)).first()
        assert c.subscription_id is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_statement_reconcile.py -v`
Expected: ImportError.

- [ ] **Step 3: Create `reconcile.py`**

```python
# src/blackmamba/core/statement/reconcile.py
from datetime import date
from sqlmodel import Session, select
from sqlalchemy.engine import Engine
from ..models import Subscription, BankCharge

AMOUNT_TOLERANCE = 2.0  # dollars; loose on purpose to absorb tax / FX

def _matches_amount(sub_amount: float | None, charge_amount: float) -> bool:
    if sub_amount is None:
        return True  # subscription with no known amount: trust merchant match
    return abs(sub_amount - charge_amount) <= AMOUNT_TOLERANCE

def _infer_monthly(dates: list[date]) -> bool:
    if len(dates) < 2:
        return False
    sorted_dates = sorted(dates)
    for a, b in zip(sorted_dates, sorted_dates[1:]):
        delta = (b - a).days
        if 25 <= delta <= 35:
            return True
    return False

def _infer_annual(dates: list[date]) -> bool:
    if len(dates) < 2:
        return False
    sorted_dates = sorted(dates)
    for a, b in zip(sorted_dates, sorted_dates[1:]):
        delta = (b - a).days
        if 350 <= delta <= 380:
            return True
    return False

def reconcile_charges(engine: Engine) -> int:
    """Link unmatched BankCharge rows to subscriptions on canonical_name +
    amount-within-tolerance. Promote subscription.cadence if charge cadence
    is clear. Returns the number of charges newly linked."""
    linked = 0
    with Session(engine) as s:
        subs = s.exec(select(Subscription)).all()
        by_name = {sub.canonical_name: sub for sub in subs}
        unlinked = s.exec(
            select(BankCharge).where(BankCharge.subscription_id.is_(None))
        ).all()
        for c in unlinked:
            sub = by_name.get(c.canonical_name)
            if sub is None:
                continue
            if not _matches_amount(sub.amount, c.amount):
                continue
            c.subscription_id = sub.id
            linked += 1
        s.commit()

        for sub in subs:
            charges = s.exec(
                select(BankCharge).where(BankCharge.subscription_id == sub.id)
            ).all()
            dates = [c.posted_at for c in charges]
            if sub.cadence in ("unknown", "one_time"):
                if _infer_monthly(dates):
                    sub.cadence = "monthly"
                elif _infer_annual(dates):
                    sub.cadence = "annual"
            if charges:
                sub.last_seen_at = max(sub.last_seen_at,
                                       max(c.imported_at for c in charges))
                if sub.confidence < 0.9:
                    sub.confidence = min(0.9, sub.confidence + 0.2 * len(charges))
        s.commit()
    return linked
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_statement_reconcile.py -v`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blackmamba/core/statement/reconcile.py tests/test_statement_reconcile.py
git commit -m "feat(statement): reconcile bank charges to subscriptions + cadence inference"
```

---

## Task 7: Trial-signal detector (verify charges + missing-charge trials)

**Files:**
- Create: `src/blackmamba/core/statement/trial_signal.py`
- Test: `tests/test_statement_trial_signal.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_statement_trial_signal.py
from datetime import date, datetime, timedelta
from sqlmodel import Session, select
from blackmamba.core.db import get_engine, init_db
from blackmamba.core.models import Subscription, BankCharge
from blackmamba.core.statement.trial_signal import (
    flag_verify_charges, promote_gmail_only_signups_to_trial,
)

def _seed_sub(s, **overrides):
    base = dict(merchant="ChatGPT", canonical_name="chatgpt",
                cadence="unknown", amount=None, currency="USD",
                status="active", necessity="unknown", necessity_source="llm",
                confidence=0.5,
                first_seen_at=datetime.now(), last_seen_at=datetime.now())
    base.update(overrides); sub = Subscription(**base); s.add(sub); return sub

def _seed_charge(s, **overrides):
    base = dict(source_file="x.csv", external_id="x",
                posted_at=date(2026,1,1), merchant_raw="X",
                canonical_name="x", amount=1.0, currency="USD",
                imported_at=datetime.now())
    base.update(overrides); s.add(BankCharge(**base))

def test_flag_one_dollar_verify_charge(tmp_path):
    engine = get_engine(str(tmp_path / "t.db")); init_db(engine)
    with Session(engine) as s:
        _seed_charge(s, external_id="v", amount=1.00, canonical_name="chatgpt")
        s.commit()
    n = flag_verify_charges(engine)
    assert n == 1
    with Session(engine) as s:
        c = s.exec(select(BankCharge)).first()
        assert c.is_trial_verify is True

def test_flag_penny_verify_charge(tmp_path):
    engine = get_engine(str(tmp_path / "t.db")); init_db(engine)
    with Session(engine) as s:
        _seed_charge(s, external_id="v", amount=0.01, canonical_name="x")
        s.commit()
    flag_verify_charges(engine)
    with Session(engine) as s:
        assert s.exec(select(BankCharge)).first().is_trial_verify

def test_does_not_flag_normal_charge(tmp_path):
    engine = get_engine(str(tmp_path / "t.db")); init_db(engine)
    with Session(engine) as s:
        _seed_charge(s, external_id="v", amount=15.99, canonical_name="netflix")
        s.commit()
    flag_verify_charges(engine)
    with Session(engine) as s:
        assert s.exec(select(BankCharge)).first().is_trial_verify is False

def test_gmail_signup_without_charge_promoted_to_trial(tmp_path):
    engine = get_engine(str(tmp_path / "t.db")); init_db(engine)
    with Session(engine) as s:
        _seed_sub(s, canonical_name="chatgpt", cadence="unknown",
                  first_seen_at=datetime.now() - timedelta(days=3),
                  last_seen_at=datetime.now() - timedelta(days=3))
        s.commit()
    n = promote_gmail_only_signups_to_trial(engine, max_age_days=14)
    assert n == 1
    with Session(engine) as s:
        sub = s.exec(select(Subscription)).first()
        assert sub.cadence == "trial"

def test_does_not_promote_when_charge_exists(tmp_path):
    engine = get_engine(str(tmp_path / "t.db")); init_db(engine)
    with Session(engine) as s:
        sub = _seed_sub(s, canonical_name="netflix", cadence="unknown")
        s.commit(); s.refresh(sub)
        _seed_charge(s, external_id="c", amount=15.99,
                     canonical_name="netflix", subscription_id=sub.id)
        s.commit()
    promote_gmail_only_signups_to_trial(engine, max_age_days=14)
    with Session(engine) as s:
        sub = s.exec(select(Subscription)).first()
        assert sub.cadence != "trial"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_statement_trial_signal.py -v`
Expected: ImportError.

- [ ] **Step 3: Create `trial_signal.py`**

```python
# src/blackmamba/core/statement/trial_signal.py
from datetime import datetime, timedelta
from sqlmodel import Session, select
from sqlalchemy.engine import Engine
from ..models import Subscription, BankCharge

VERIFY_AMOUNTS = {0.01, 1.00}

def flag_verify_charges(engine: Engine) -> int:
    flagged = 0
    with Session(engine) as s:
        rows = s.exec(
            select(BankCharge).where(BankCharge.is_trial_verify.is_(False))
        ).all()
        for r in rows:
            if round(r.amount, 2) in VERIFY_AMOUNTS:
                r.is_trial_verify = True
                flagged += 1
        s.commit()
    return flagged

def promote_gmail_only_signups_to_trial(engine: Engine, max_age_days: int = 14) -> int:
    """Subscription with no linked BankCharge and seen within the last
    `max_age_days` is treated as a likely active trial."""
    cutoff = datetime.now() - timedelta(days=max_age_days)
    promoted = 0
    with Session(engine) as s:
        subs = s.exec(select(Subscription)).all()
        for sub in subs:
            if sub.cadence == "trial":
                continue
            if sub.first_seen_at < cutoff:
                continue
            has_charge = s.exec(
                select(BankCharge).where(BankCharge.subscription_id == sub.id)
            ).first()
            if has_charge:
                continue
            sub.cadence = "trial"
            promoted += 1
        s.commit()
    return promoted
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_statement_trial_signal.py -v`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blackmamba/core/statement/trial_signal.py tests/test_statement_trial_signal.py
git commit -m "feat(statement): trial signals (verify charges + missing-charge signups)"
```

---

## Task 8: TUI upload screen + binding

**Files:**
- Create: `src/blackmamba/tui/screens/upload.py`
- Modify: `src/blackmamba/tui/screens/subscriptions.py`, `src/blackmamba/tui/app.py`

Dogfood-only — no automated tests.

- [ ] **Step 1: Create the upload screen**

```python
# src/blackmamba/tui/screens/upload.py
from pathlib import Path
from textual.app import ComposeResult
from textual.containers import Vertical
from textual.screen import Screen
from textual.widgets import Header, Footer, Input, Static, Button, OptionList, Log
from textual.widgets.option_list import Option
from sqlalchemy.engine import Engine
from blackmamba.core.statement.csv_parser import read_headers
from blackmamba.core.statement.mapping import (
    CsvFieldMap, fingerprint_headers, save_mapping, load_mapping_by_fingerprint,
)
from blackmamba.core.statement.ingestor import ingest_statement
from blackmamba.core.statement.reconcile import reconcile_charges
from blackmamba.core.statement.trial_signal import (
    flag_verify_charges, promote_gmail_only_signups_to_trial,
)

class UploadScreen(Screen):
    BINDINGS = [("escape", "back", "Back")]

    def __init__(self, engine: Engine):
        super().__init__()
        self._engine = engine
        self._path: Path | None = None
        self._headers: list[str] = []
        self._mapping: CsvFieldMap | None = None

    def compose(self) -> ComposeResult:
        yield Header(show_clock=False)
        yield Vertical(
            Static("Drop or type the CSV path:"),
            Input(placeholder="/path/to/statement.csv", id="path"),
            Static("Bank key (e.g. chase, amex):"),
            Input(placeholder="chase", id="bank"),
            Static("Date column:"),
            Input(id="col_date"),
            Static("Merchant/description column:"),
            Input(id="col_merchant"),
            Static("Amount column:"),
            Input(id="col_amount"),
            Static("Amount sign (negative_is_debit | positive_is_debit):"),
            Input(value="negative_is_debit", id="col_sign"),
            Button("Detect headers", id="detect"),
            Button("Import", id="import"),
            Log(id="log"),
        )
        yield Footer()

    def action_back(self) -> None:
        self.app.pop_screen()

    def on_button_pressed(self, event: Button.Pressed) -> None:
        log = self.query_one("#log", Log)
        if event.button.id == "detect":
            path = Path(self.query_one("#path", Input).value).expanduser()
            if not path.exists():
                log.write_line(f"Not found: {path}"); return
            self._path = path
            self._headers = read_headers(path)
            log.write_line(f"Headers: {self._headers}")
            existing = load_mapping_by_fingerprint(self._headers, self._engine)
            if existing:
                log.write_line(f"Found saved mapping: {existing}")
                self.query_one("#col_date", Input).value = existing.date
                self.query_one("#col_merchant", Input).value = existing.merchant
                self.query_one("#col_amount", Input).value = existing.amount
                self.query_one("#col_sign", Input).value = existing.amount_sign
        elif event.button.id == "import":
            if not self._path:
                log.write_line("Click 'Detect headers' first."); return
            mapping = CsvFieldMap(
                date=self.query_one("#col_date", Input).value,
                merchant=self.query_one("#col_merchant", Input).value,
                amount=self.query_one("#col_amount", Input).value,
                amount_sign=self.query_one("#col_sign", Input).value,
            )
            bank_key = self.query_one("#bank", Input).value or "unknown"
            save_mapping(bank_key=bank_key, headers=self._headers,
                         mapping=mapping, engine=self._engine)
            n = ingest_statement(self._path, mapping, self._engine)
            linked = reconcile_charges(self._engine)
            flagged = flag_verify_charges(self._engine)
            promoted = promote_gmail_only_signups_to_trial(self._engine)
            log.write_line(
                f"Imported {n}, linked {linked}, verify-charges {flagged}, "
                f"trials promoted {promoted}"
            )
```

- [ ] **Step 2: Wire the upload binding into the subscriptions screen**

Edit `src/blackmamba/tui/screens/subscriptions.py`:

```python
# extend BINDINGS:
BINDINGS = [("r", "refresh", "Refresh"), ("c", "cancel", "Cancel selected"),
            ("u", "upload", "Upload statement"), ("q", "quit", "Quit")]

# add method:
def action_upload(self) -> None:
    self.app.open_upload_screen()
```

- [ ] **Step 3: Register the upload screen launcher in `app.py`**

```python
# add import:
from blackmamba.tui.screens.upload import UploadScreen

# add method on BlackMambaApp:
def open_upload_screen(self) -> None:
    self.push_screen(UploadScreen(self._engine))
```

- [ ] **Step 4: Verify imports**

Run: `uv run python -c "from blackmamba.tui.app import BlackMambaApp; print('ok')"`
Expected: `ok`.

- [ ] **Step 5: Run tests**

Run: `uv run pytest -v`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/blackmamba/tui/screens/upload.py src/blackmamba/tui/screens/subscriptions.py src/blackmamba/tui/app.py
git commit -m "feat(tui): statement upload screen with column mapping"
```

---

## Task 9: Dogfood end-to-end

Manual.

- [ ] **Step 1: Run tests**

Run: `uv run pytest -v`
Expected: all green.

- [ ] **Step 2: Export a real CSV**

Export the last 90 days from your bank as CSV.

- [ ] **Step 3: Launch and upload**

Run: `uv run blackmamba`. Press `u`, enter the path, click `Detect headers`, fill in columns, click `Import`. Confirm:
- Log shows imported count > 0.
- After exit and re-launch, refreshing the subscriptions table shows updated `cadence` for previously-`unknown` rows and any trial-promotion.

- [ ] **Step 4: Verify with a known sub**

Pick a known monthly sub (e.g. Netflix). Confirm in TUI that its `cadence = monthly` after upload.

- [ ] **Step 5: File issues**

For each mismatch (sub not linked, wrong cadence, verify-charge missed), file an issue with the CSV row + the canonical_name we resolved.

---

## Self-review notes

- Spec §2 in-scope items "Optional CSV bank-statement upload" and "$0.01 / $1 verify-charge trial signal" — covered by Tasks 4-7.
- Spec §5 row `stmt_ingestor` (user upload → CSV mapping → emit normalized charge events): Tasks 3-5.
- Spec §5 `detect & reconcile` cross-stream merging: Task 6 implements the Gmail-side `subscription` to bank-side `BankCharge` join; existing Gmail-only detect from Plan 1 still runs first.
- Spec §6 `bank_charge`-equivalent table: BankCharge in Task 1. Spec didn't enumerate this table but it follows naturally; added a `CsvMapping` table for per-bank column-mapping persistence (mentioned in spec §9: "user maps columns once in TUI, save the mapping per bank for next time").
- Spec §9 "unknown CSV schema → user maps columns once, save the mapping per bank for next time" — Tasks 3 + 8.
- PDF parsing stretch goal (§2) explicitly deferred.
- Cadence inference uses ±5-day windows for monthly and 350-380 days for annual — purposefully loose to absorb weekend posting drift and prorated first charges; tighten later if false positives appear in dogfood.
