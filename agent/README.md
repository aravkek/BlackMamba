# Switchback Browser Agent

Python service that runs Browser-Use to cancel subscriptions autonomously.
The Next.js app calls this on `localhost:8001/cancel` from `/api/cancel-live`.

## Setup

```bash
cd agent
source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium
cp .env.example .env
# add OPENAI_API_KEY (or ANTHROPIC_API_KEY) to .env
```

## Run

```bash
uvicorn main:app --reload --port 8001
```

## Test

```bash
# health
curl http://localhost:8001/health

# cancel (use a softball target first — example.com, a substack, etc.)
curl -X POST http://localhost:8001/cancel \
  -H 'Content-Type: application/json' \
  -d '{"merchant":"Substack Test","url":"https://example.com","headless":false}'
```

## Notes for stage demo

- `headless: false` so judges SEE the browser drive itself
- 300s timeout total
- Pre-record a successful run as backup video before going on stage
