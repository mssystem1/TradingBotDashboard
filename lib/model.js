const MODEL = "typesafe-ai/jev";
const MANUAL_MODELS = new Map([
  [MODEL, "Jev"],
  ["openai/gpt-4.1-mini", "OpenAI"],
]);
const manualModelId = () => process.env.MANUAL_SIGNAL_MODEL?.trim() || MODEL;

export class GatewayError extends Error {}

export function manualModelName() {
  return MANUAL_MODELS.get(manualModelId());
}

export function modelEnabled(kind) {
  const flag = { scheduled: "ENABLE_SCHEDULED_MODEL", jev: "ENABLE_MANUAL_JEV", manual: "ENABLE_MANUAL_MODEL" }[kind];
  return Boolean(flag) && process.env[flag] === "true" && Boolean(process.env.AI_GATEWAY_API_KEY?.trim()) &&
    (kind !== "manual" || MANUAL_MODELS.has(manualModelId()));
}

async function gateway(path, body, name) {
  const response = await fetch("https://ai-gateway.vercel.sh" + path, {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.AI_GATEWAY_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(7500),
    redirect: "error",
  });
  if (response.ok) return response.json();
  const payload = await response.json().catch(() => ({}));
  const code = payload?.error?.type || payload?.error?.code;
  if (code === "no_providers_available") {
    throw new GatewayError(`AI Gateway found no eligible provider for ${name}. Paper trading is available.`);
  }
  if (response.status === 401 || response.status === 403) {
    throw new GatewayError(`AI Gateway denied access to ${name}. Paper trading is available.`);
  }
  throw new GatewayError(`AI Gateway could not return a ${name} signal. Paper trading is available.`);
}

export async function signal(metrics, kind) {
  if (!modelEnabled(kind)) throw new Error("Model requests are disabled");
  const started = performance.now();
  const { answers } = await gateway("/typesafe/v1/systemone", {
    model: MODEL,
    state: JSON.stringify(metrics),
    questions: {
      side: {
        type: "choice",
        instructions: "Forecast if the midpoint will rise (buy) or fall (sell) over the next 15 minutes using the market inputs.",
        criteria: { buy: null, sell: null },
      },
    },
  }, "Jev");
  const side = answers?.side?.choice;
  const confidence = answers?.side?.probabilities?.[side];
  if (!["buy", "sell"].includes(side) || !Number.isFinite(confidence) || confidence < 0.5 || confidence > 1) {
    throw new Error("Invalid model response");
  }
  return { side, confidence, model: MODEL, latencyMs: Math.round(performance.now() - started) };
}

export async function manualSignal(coin, metrics) {
  if (!modelEnabled("manual")) throw new Error("Model requests are disabled");
  const model = manualModelId();
  if (model === MODEL) return signal(metrics, "manual");
  const name = MANUAL_MODELS.get(model);
  const started = performance.now();
  const data = await gateway("/v1/chat/completions", {
    model,
    messages: [
      { role: "system", content: "For a paper-trading dashboard, describe the likely direction of the market midpoint in the next 15 minutes from only the supplied public data. Use unclear when evidence is limited. Return a JSON object with direction (up, down, or unclear) and reason (one short sentence)." },
      { role: "user", content: JSON.stringify({ market: coin, ...metrics }) },
    ],
    response_format: { type: "json_object" },
    max_tokens: 160,
    stream: false,
  }, name);
  let view;
  try {
    view = JSON.parse(data.choices?.[0]?.message?.content);
  } catch {
    throw new GatewayError(`${name} returned a signal the dashboard could not read.`);
  }
  if (!["up", "down", "unclear"].includes(view?.direction) || typeof view?.reason !== "string" || !view.reason.trim()) {
    throw new GatewayError(`${name} returned a signal the dashboard could not read.`);
  }
  return { direction: view.direction, reason: view.reason.trim().slice(0, 300), model, name,
    latencyMs: Math.round(performance.now() - started) };
}
