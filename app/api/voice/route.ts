import { NextResponse } from "next/server";

// Always run server-side at request time; we forward audio bytes.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ARIA_VOICE_ID = "9BWtsMINqrJLrRacOk9x";
const MODEL_ID = "eleven_turbo_v2_5";
const ENDPOINT = `https://api.elevenlabs.io/v1/text-to-speech/${ARIA_VOICE_ID}`;
const MAX_TEXT_LEN = 1000;

type VoiceBody = { text?: unknown };

export async function POST(req: Request): Promise<Response> {
  let body: VoiceBody;
  try {
    body = (await req.json()) as VoiceBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "text_required" }, { status: 400 });
  }
  if (text.length > MAX_TEXT_LEN) {
    return NextResponse.json({ error: "text_too_long" }, { status: 400 });
  }

  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    // Graceful demo fallback — frontend treats this as "skip playback".
    return new Response("mock-audio", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  try {
    const upstream = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: MODEL_ID,
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.8,
          style: 0.2,
          use_speaker_boost: true,
        },
      }),
      // Abort if ElevenLabs is slow — better to fall back than freeze the demo.
      signal: AbortSignal.timeout(15_000),
    });

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "");
      console.error(
        "[voice] elevenlabs_error",
        upstream.status,
        detail.slice(0, 200),
      );
      return new Response("mock-audio", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // Stream the MP3 straight through to the client.
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[voice] fetch_failure", err);
    return new Response("mock-audio", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
}
