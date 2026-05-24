import { NextResponse } from "next/server";

// Proxies the streaming cancel endpoints exposed by the Python agent:
//   POST /api/cancel-live              -> agent POST /cancel/start (returns run_id)
//   GET  /api/cancel-live?run_id=...   -> agent GET /cancel/runs/{run_id}
//   GET  /api/cancel-live              -> agent GET /health (legacy)

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30; // start is fast; polling is cheap

const AGENT_BASE_URL = process.env.AGENT_BASE_URL ?? "http://localhost:8001";

type StartCancelBody = {
  merchant?: unknown;
  url?: unknown;
  headless?: unknown;
  max_steps?: unknown;
};

type CancelStep = {
  index: number;
  action: string;
  url?: string | null;
  note?: string | null;
};

type JobResponse = {
  run_id: string;
  merchant: string;
  status: "pending" | "running" | "success" | "failed";
  steps: CancelStep[];
  final_url?: string | null;
  error?: string | null;
  duration_ms: number;
};

export async function POST(req: Request): Promise<NextResponse> {
  let body: StartCancelBody;
  try {
    body = (await req.json()) as StartCancelBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const merchant =
    typeof body.merchant === "string" ? body.merchant.trim() : "";
  if (!merchant) {
    return NextResponse.json({ error: "merchant_required" }, { status: 400 });
  }

  const url = typeof body.url === "string" ? body.url.trim() : undefined;
  const headless = typeof body.headless === "boolean" ? body.headless : false;
  const maxSteps =
    typeof body.max_steps === "number" && body.max_steps > 0
      ? Math.min(body.max_steps, 200)
      : 40;

  try {
    const upstream = await fetch(`${AGENT_BASE_URL}/cancel/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ merchant, url, headless, max_steps: maxSteps }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      console.error(
        "[cancel-live] start_failed",
        upstream.status,
        detail.slice(0, 200),
      );
      return NextResponse.json(
        { error: `agent_${upstream.status}` },
        { status: 502 },
      );
    }

    return NextResponse.json(await upstream.json());
  } catch (err) {
    console.error("[cancel-live] start_fetch_failure", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "agent_unreachable" },
      { status: 502 },
    );
  }
}

export async function GET(req: Request): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const runId = searchParams.get("run_id");

  // No run_id → health passthrough (backward compat with the old route).
  if (!runId) {
    try {
      const upstream = await fetch(`${AGENT_BASE_URL}/health`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (!upstream.ok) {
        return NextResponse.json(
          { status: "down", code: upstream.status },
          { status: 502 },
        );
      }
      return NextResponse.json(await upstream.json());
    } catch (err) {
      return NextResponse.json(
        {
          status: "unreachable",
          error: err instanceof Error ? err.message : String(err),
        },
        { status: 502 },
      );
    }
  }

  // run_id provided → poll job state.
  try {
    const upstream = await fetch(
      `${AGENT_BASE_URL}/cancel/runs/${encodeURIComponent(runId)}`,
      { signal: AbortSignal.timeout(5_000) },
    );
    if (upstream.status === 404) {
      return NextResponse.json({ error: "run_not_found" }, { status: 404 });
    }
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `agent_${upstream.status}` },
        { status: 502 },
      );
    }
    return NextResponse.json((await upstream.json()) as JobResponse);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "agent_unreachable" },
      { status: 502 },
    );
  }
}
