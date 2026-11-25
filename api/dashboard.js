import { hasSession, html, json, privacyHeaders, requestBody, sameOrigin, sameSecret, sessionCookie } from "../lib/http.js";
import { marketState, priceHistory, quote, validCoin } from "../lib/market.js";
import { modelEnabled, signal } from "../lib/model.js";
import { alertStore, publicStatus, setPaused } from "../lib/state.js";
import { allowedChat } from "../lib/telegram.js";
import { accessPage, dashboard } from "../lib/views.js";

export default async function handler(req, res) {
  privacyHeaders(res);
  const url = new URL(req.url, "http://localhost");
  const view = url.searchParams.get("view");
  const key = process.env.DASHBOARD_ACCESS_KEY;
  const configured = Boolean(key && /^[A-Za-z0-9_-]{32,128}$/.test(key) &&
    (!process.env.VERCEL || process.env.APP_ORIGIN?.startsWith("https://")));
  if (!configured) {
    return view || req.method !== "GET" ? json(res, 503, { error: "Dashboard setup required" }) :
      html(res, 503, "<!doctype html><h1>Dashboard setup required</h1><p>The owner must configure private access.</p>");
  }

  const hasAccess = hasSession(req, key);
  if (req.method === "GET" && !view) return html(res, 200, hasAccess ? dashboard : accessPage);
  if (req.method === "POST" && !sameOrigin(req)) return json(res, 403, { error: "Origin check failed" });

  let body;
  if (req.method === "POST") {
    try {
      body = await requestBody(req);
    } catch {
      return json(res, 400, { error: "Invalid request" });
    }
    if (body?.action === "open") {
      if (!sameSecret(body.key, key)) return json(res, 401, { error: "Access link is invalid" });
      res.setHeader("Set-Cookie", sessionCookie(key));
      res.statusCode = 204;
      return res.end();
    }
  }
  if (!hasAccess) return json(res, 401, { error: "Open your private dashboard link" });

  if (req.method === "POST" && body?.action === "logout") {
    res.setHeader("Set-Cookie", sessionCookie(key, true));
    return json(res, 200, { locked: true });
  }

  try {
    if (req.method === "GET" && view === "quote") {
      const coin = url.searchParams.get("coin") || "BTC";
      if (!validCoin(coin)) return json(res, 400, { error: "Unsupported market" });
      const [latest, history] = await Promise.all([
        quote(coin),
        url.searchParams.get("history") === "1" ? priceHistory(coin).catch(() => []) : [],
      ]);
      return json(res, 200, { quote: latest, history });
    }
    if (req.method === "GET" && view === "status") {
      const connected = Boolean(process.env.BLOB_READ_WRITE_TOKEN && process.env.TELEGRAM_BOT_TOKEN && allowedChat());
      let alerts = null;
      let alertError = false;
      if (connected) {
        try {
          alerts = publicStatus(await alertStore().current());
        } catch {
          alertError = true;
        }
      }
      return json(res, 200, { alerts, manualModel: modelEnabled("manual"), scheduledModel: modelEnabled("scheduled"),
        ...(alertError ? { alertError } : {}) });
    }
    if (req.method === "POST" && body?.action === "alerts" && typeof body.paused === "boolean") {
      if (!allowedChat() || !process.env.TELEGRAM_BOT_TOKEN) return json(res, 503, { error: "Telegram is not configured" });
      const { value } = await setPaused(alertStore(), body.paused);
      return json(res, 200, { alerts: publicStatus(value) });
    }
    if (req.method === "POST" && body?.action === "judge") {
      if (!validCoin(body.coin)) return json(res, 400, { error: "Unsupported market" });
      if (!modelEnabled("manual")) return json(res, 403, { error: "Manual model calls are disabled" });
      const { metrics } = await marketState(body.coin);
      const call = await signal(metrics, "manual");
      return json(res, 200, { call, quote: await quote(body.coin) });
    }
    return json(res, 404, { error: "Route unavailable" });
  } catch {
    return json(res, 503, { error: "Could not complete the request. Check the provider and try again." });
  }
}
