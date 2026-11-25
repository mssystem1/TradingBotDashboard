import { hasSession, html, json, privacyHeaders, requestBody, sameOrigin, sameSecret, sessionCookie } from "../lib/http.js";
import { marketState, quote, validCoin } from "../lib/market.js";
import { modelEnabled, signal } from "../lib/model.js";
import { alertStore, publicStatus, setPaused } from "../lib/state.js";
import { allowedChat } from "../lib/telegram.js";
import { dashboard, loginPage } from "../lib/views.js";

export default async function handler(req, res) {
  privacyHeaders(res);
  const url = new URL(req.url, "http://localhost");
  const view = url.searchParams.get("view");
  const password = process.env.DASHBOARD_PASSWORD;
  const configured = Boolean(password?.length >= 32 && (!process.env.VERCEL || process.env.APP_ORIGIN?.startsWith("https://")));
  if (!configured) {
    return view || req.method !== "GET" ? json(res, 503, { error: "Dashboard setup required" }) :
      html(res, 503, "<!doctype html><h1>Dashboard setup required</h1><p>The owner must configure private access.</p>");
  }

  const signedIn = hasSession(req, password);
  if (req.method === "GET" && !view) return html(res, 200, signedIn ? dashboard : loginPage());
  if (req.method === "POST" && !sameOrigin(req)) return json(res, 403, { error: "Origin check failed" });

  let body;
  if (req.method === "POST") {
    try {
      body = await requestBody(req);
    } catch {
      return json(res, 400, { error: "Invalid request" });
    }
    if (body?.action === "login") {
      if (!sameSecret(body.password, password)) return html(res, 401, loginPage("Passphrase did not match."));
      res.setHeader("Set-Cookie", sessionCookie(password));
      res.statusCode = 303;
      res.setHeader("Location", "/");
      return res.end();
    }
  }
  if (!signedIn) return json(res, 401, { error: "Sign in to the dashboard" });

  if (req.method === "POST" && body?.action === "logout") {
    res.setHeader("Set-Cookie", sessionCookie(password, true));
    res.statusCode = 303;
    res.setHeader("Location", "/");
    return res.end();
  }

  try {
    if (req.method === "GET" && view === "quote") {
      const coin = url.searchParams.get("coin") || "BTC";
      if (!validCoin(coin)) return json(res, 400, { error: "Unsupported market" });
      return json(res, 200, { quote: await quote(coin) });
    }
    if (req.method === "GET" && view === "status") {
      const connected = Boolean(process.env.BLOB_READ_WRITE_TOKEN && process.env.TELEGRAM_BOT_TOKEN && allowedChat());
      const alerts = connected ? publicStatus(await alertStore().current()) : null;
      return json(res, 200, { alerts, manualModel: modelEnabled("manual"), scheduledModel: modelEnabled("scheduled") });
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
