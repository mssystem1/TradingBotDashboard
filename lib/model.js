const MODEL = "typesafe-ai/jev";

export function modelEnabled(kind) {
  const flag = kind === "scheduled" ? "ENABLE_SCHEDULED_MODEL" : "ENABLE_MANUAL_MODEL";
  return process.env[flag] === "true" && Boolean(process.env.AI_GATEWAY_API_KEY?.trim());
}

export async function signal(metrics, kind) {
  if (!modelEnabled(kind)) throw new Error("Model requests are disabled");
  const started = performance.now();
  const response = await fetch("https://ai-gateway.vercel.sh/typesafe/v1/systemone", {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.AI_GATEWAY_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      state: JSON.stringify(metrics),
      questions: {
        side: {
          type: "choice",
          instructions: "Forecast if the midpoint will rise (buy) or fall (sell) over the next 15 minutes using the market inputs.",
          criteria: { buy: null, sell: null },
        },
      },
    }),
    signal: AbortSignal.timeout(7500),
    redirect: "error",
  });
  if (!response.ok) throw new Error("Model returned HTTP " + response.status);
  const { answers } = await response.json();
  const side = answers?.side?.choice;
  const confidence = answers?.side?.probabilities?.[side];
  if (!["buy", "sell"].includes(side) || !Number.isFinite(confidence) || confidence < 0.5 || confidence > 1) {
    throw new Error("Invalid model response");
  }
  return { side, confidence, model: MODEL, latencyMs: Math.round(performance.now() - started) };
}
