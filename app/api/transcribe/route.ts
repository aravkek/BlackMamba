import { NextResponse } from "next/server";

// Proxies browser audio (multipart) → Backboard STT (Whisper).
// Returns just the transcript text — caller fills the chat composer with it.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const BACKBOARD_BASE_URL = (
  process.env.BACKBOARD_BASE_URL ?? "https://app.backboard.io/api"
).replace(/\/+$/, "");

const STT_PROVIDER = process.env.BACKBOARD_STT_PROVIDER ?? "openai";
const STT_MODEL = process.env.BACKBOARD_STT_MODEL ?? "whisper-1";

export async function POST(req: Request): Promise<NextResponse> {
  const key = process.env.BACKBOARD_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "BACKBOARD_API_KEY missing" },
      { status: 500 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid_multipart" }, { status: 400 });
  }

  const audio = form.get("audio") as Blob | null;
  if (!audio || typeof (audio as Blob).size !== "number") {
    return NextResponse.json(
      { error: "audio_field_required" },
      { status: 400 },
    );
  }

  // Build the Backboard multipart payload.
  const upstreamForm = new FormData();
  upstreamForm.append(
    "voice",
    JSON.stringify({
      stt: { provider: STT_PROVIDER, model: STT_MODEL, language: "en" },
    }),
  );
  upstreamForm.append("send_to_llm", "false");
  // Re-name to .webm so Backboard / Whisper recognize the codec MediaRecorder emits.
  const filename = (audio as File).name || "speech.webm";
  upstreamForm.append("audio_file", audio, filename);

  try {
    const upstream = await fetch(`${BACKBOARD_BASE_URL}/threads/messages`, {
      method: "POST",
      headers: { "X-API-Key": key },
      body: upstreamForm,
      signal: AbortSignal.timeout(45_000),
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      console.error(
        "[transcribe] backboard non_ok",
        upstream.status,
        detail.slice(0, 300),
      );
      return NextResponse.json(
        { error: `backboard_${upstream.status}` },
        { status: 502 },
      );
    }

    const json = (await upstream.json()) as {
      voice_records?: { stt?: { transcript?: string } };
      content?: string;
    };
    const transcript =
      json.voice_records?.stt?.transcript?.trim() ??
      json.content?.trim() ??
      "";

    return NextResponse.json({ transcript });
  } catch (err) {
    console.error("[transcribe] fetch_failure", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "transcribe_unreachable" },
      { status: 502 },
    );
  }
}
