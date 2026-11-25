import { checkAlerts } from "../lib/alerts.js";
import { json, privacyHeaders, sameSecret } from "../lib/http.js";
import { marketState, validCoin } from "../lib/market.js";
import { modelEnabled, signal } from "../lib/model.js";
import { alertStore } from "../lib/state.js";
import { allowedChat, send } from "../lib/telegram.js";

export default async function handler(req, res) {
  privacyHeaders(res);
  if (req.method !== "POST") return json(res, 405, { error: "Use POST" });
  const [scheme, credential] = (req.headers.authorization || "").split(" ");
  if (scheme !== "Bearer" || !sameSecret(credential, process.env.ALERT_JOB_SECRET)) {
    return json(res, 401, { error: "Unauthorized" });
  }
  if (!modelEnabled("scheduled")) return json(res, 200, { result: "Scheduled model requests disabled" });
  const limit = Number(process.env.ALERT_MAX_CALLS_PER_DAY || 24);
  const coin = process.env.ALERT_COIN || "BTC";
  if (!allowedChat() || !process.env.TELEGRAM_BOT_TOKEN || !Number.isInteger(limit) || limit < 1 || limit > 96 || !validCoin(coin)) {
    return json(res, 503, { error: "Alert settings are incomplete" });
  }
  try {
    const result = await checkAlerts({ store: alertStore(), marketState, signal, send, coin, limit });
    return json(res, 200, { result });
  } catch {
    return json(res, 503, { error: "Alert check unavailable. No automatic model retry." });
  }
}
