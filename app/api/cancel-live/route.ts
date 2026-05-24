import { NextResponse } from "next/server";

// This route proxies to the Python browser-agent service (FastAPI on :8001).
// We never expose the agent service directly to the browser — Next.js fronts it
// so we keep CORS / auth controlled and can return a normalized shape.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Agent runs can take minutes; bump the default function timeout for vercel.
export const maxDuration = 300;

const AGENT_BASE_URL = process.env.AGENT_BASE_URL ?? "http://localhost:8001";

type LiveCancelBody = {
  merchant?: unknown;
  url?: unknown;
  headless?: unknown;
};

type AgentStep = {
  index: number;
  action: string;
  url?: string | null;
  note?: string | null;
};

type AgentResult = {
  success: boolean;
  merchant: string;
  duration_ms: number;
  steps: AgentStep[];
  final_url?: string | null;
  error?: string | null;
};

export async function POST(req: Request): Promise<NextResponse> {
  let body: LiveCancelBody;
  try {
    body = (await req.json()) as LiveCancelBody;
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

  try {
    const upstream = await fetch(`${AGENT_BASE_URL}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant,
        url,
        headless,
      }),
      // Give the agent up to 5 minutes; abort after that.
      signal: AbortSignal.timeout(305_000),
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      console.error(
        "[cancel-live] agent_error",
        upstream.status,
        detail.slice(0, 200),
      );
      return NextResponse.json(
        {
          success: false,
          merchant,
          duration_ms: 0,
          steps: [],
          error: `agent_${upstream.status}`,
        } satisfies AgentResult,
        { status: 502 },
      );
    }

    const result = (await upstream.json()) as AgentResult;
    return NextResponse.json(result);
  } catch (err) {
    console.error("[cancel-live] fetch_failure", err);
    return NextResponse.json(
      {
        success: false,
        merchant,
        duration_ms: 0,
        steps: [],
        error: err instanceof Error ? err.message : "agent_unreachable",
      } satisfies AgentResult,
      { status: 502 },
    );
  }
}

export async function GET(): Promise<NextResponse> {
  // Health passthrough so the UI can show "agent: ok" before kicking off a cancel.
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
    const json = await upstream.json();
    return NextResponse.json(json);
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
