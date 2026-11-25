import { json, privacyHeaders, requestBody, sameSecret } from "../lib/http.js";
import { alertStore, setPaused } from "../lib/state.js";
import { allowedChat, send } from "../lib/telegram.js";

export default async function handler(req, res) {
  privacyHeaders(res);
  if (req.method !== "POST") return json(res, 405, { error: "Use POST" });
  if (!sameSecret(req.headers["x-telegram-bot-api-secret-token"], process.env.TELEGRAM_WEBHOOK_SECRET)) {
    return json(res, 401, { error: "Unauthorized" });
  }
  let update;
  try {
    update = await requestBody(req);
  } catch {
    return json(res, 400, { error: "Invalid update" });
  }
  const message = update?.message;
  const chat = allowedChat();
  const age = Math.floor(Date.now() / 1000) - message?.date;
  if (!chat || message?.chat?.type !== "private" || String(message.chat.id) !== chat ||
      String(message.from?.id) !== chat || !Number.isSafeInteger(update.update_id) || !Number.isSafeInteger(message.date) ||
      age > 300 || age < -60 || typeof message.text !== "string") return json(res, 200, { ok: true });

  const cmd = message.text.trim().toLowerCase();
  try {
    if (cmd === "/pause" || cmd === "/resume") {
      const result = await setPaused(alertStore(), cmd === "/pause", { date: message.date, id: update.update_id });
      if (result.changed) await send(result.value.paused ? "Paper alerts paused." : "Paper alerts resumed.");
    } else if (cmd === "/status") {
      const { paused } = await alertStore().current();
      await send(paused ? "Paper alerts are paused. Use /resume to start." : "Paper alerts are active. Use /pause to pause.");
    } else if (cmd === "/start" || cmd === "/help") {
      await send("Jev Signal Lab paper alerts. Use /status, /pause, or /resume.");
    }
    return json(res, 200, { ok: true });
  } catch {
    return json(res, 503, { error: "Telegram control unavailable" });
  }
}
