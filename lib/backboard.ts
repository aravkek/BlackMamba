// Thin Backboard.io client used as the "agent brain" for cancel messages.
//
// Backboard exposes an OpenAI-compatible chat completions endpoint, so we
// just hit `${base}/v1/chat/completions` with a bearer token. If the request
// fails for any reason we return null and the caller falls back to a
// deterministic message — the demo never depends on Backboard staying up.

const DEFAULT_BASE = "https://api.backboard.io";
const DEFAULT_MODEL = "gpt-4o-mini";
const TIMEOUT_MS = 8_000;

type ChatChoice = { message?: { content?: string | null } };
type ChatResponse = { choices?: ChatChoice[] };

export type SwitchPlan = {
  service: string;
  switchTo?: string;
  monthlySavings: number;
  annualSavings: number;
  cardLimit: number;
};

export async function generateSwitchMessage(
  plan: SwitchPlan,
): Promise<string | null> {
  const key = process.env.BACKBOARD_API_KEY;
  if (!key) return null;

  const base = (process.env.BACKBOARD_BASE_URL ?? DEFAULT_BASE).replace(
    /\/+$/,
    "",
  );
  const model = process.env.BACKBOARD_MODEL ?? DEFAULT_MODEL;

  const userPrompt = plan.switchTo
    ? `User is canceling ${plan.service} and switching to ${plan.switchTo}. ` +
      `We're issuing a virtual card capped at $${plan.cardLimit}/month. ` +
      `They save $${plan.monthlySavings.toFixed(2)}/mo ($${plan.annualSavings.toFixed(2)}/yr).`
    : `User is canceling ${plan.service}. ` +
      `They save $${plan.monthlySavings.toFixed(2)}/mo ($${plan.annualSavings.toFixed(2)}/yr).`;

  const payload = {
    model,
    messages: [
      {
        role: "system",
        content:
          "You are BlackMamba, a calm financial assistant. Reply in one or two short sentences. " +
          "Confirm the action concretely. No emojis. No hashtags.",
      },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.4,
    max_tokens: 80,
  };

  try {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      console.error("[backboard] non_ok", res.status);
      return null;
    }

    const json = (await res.json()) as ChatResponse;
    const text = json.choices?.[0]?.message?.content?.trim();
    return text && text.length > 0 ? text : null;
  } catch (err) {
    console.error("[backboard] failure", err);
    return null;
  }
}

// Deterministic fallback so the demo always produces a sensible line.
export function fallbackSwitchMessage(plan: SwitchPlan): string {
  if (plan.switchTo) {
    return (
      `Switching you to ${plan.switchTo}. Issuing a virtual card with a ` +
      `$${plan.cardLimit} monthly cap. You'll save ` +
      `$${plan.annualSavings.toFixed(2)} per year.`
    );
  }
  return (
    `Canceled ${plan.service}. That puts $${plan.annualSavings.toFixed(2)} ` +
    `back in your pocket this year.`
  );
}
