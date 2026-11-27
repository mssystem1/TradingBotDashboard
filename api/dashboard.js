import { dashboardAdmin, trySignIn } from "../lib/auth.js";
import { hasSession, html, json, privacyHeaders, requestBody, sameOrigin, sessionCookie } from "../lib/http.js";
import { marketState, priceHistory, quote, validCoin } from "../lib/market.js";
import { GatewayError, manualModelName, manualSignal, modelEnabled, signal } from "../lib/model.js";
import { alertStore, publicStatus, setPaused } from "../lib/state.js";
import { allowedChat } from "../lib/telegram.js";
import { dashboard, signInPage } from "../lib/views.js";
import { workerStatus } from "../lib/worker-status.js";

function returnHome(res, cookie) {
  res.setHeader("Set-Cookie", cookie);
  res.setHeader("Location", "/");
  res.statusCode = 303;
  return res.end();
}

export default async function handler(req, res) {
  privacyHeaders(res);
  const url = new URL(req.url, "http://localhost");
  const view = url.searchParams.get("view");
  const { admin, setupIssue } = dashboardAdmin();
  const hasAccess = Boolean(admin && hasSession(req, admin.sessionKey));
  if (req.method === "GET" && !view) return html(res, 200, hasAccess ? dashboard() : signInPage({ setupIssue }));
  if (req.method === "POST" && !sameOrigin(req)) return json(res, 403, { error: "Origin check failed" });

  let body;
  if (req.method === "POST") {
    try {
      body = await requestBody(req);
    } catch {
      return json(res, 400, { error: "Invalid request" });
    }
    if (body?.action === "logout") return returnHome(res, sessionCookie(admin?.sessionKey, true));
    if (body?.action === "login") {
      if (!admin) return html(res, 503, signInPage({ setupIssue }));
      const { signedIn, retryAfter } = trySignIn(req, admin, body);
      if (retryAfter) {
        res.setHeader("Retry-After", String(retryAfter));
        return html(res, 429, signInPage({ error: "Too many sign-in attempts. Wait a few minutes and try again." }));
      }
      if (!signedIn) return html(res, 401, signInPage({ error: "Incorrect username or password." }));
      return returnHome(res, sessionCookie(admin.sessionKey));
    }
  }
  if (!admin) return json(res, 503, { error: "Dashboard setup required" });
  if (!hasAccess) return json(res, 401, { error: "Sign in to the dashboard" });

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
    if (req.method === "GET" && view === "history") {
      const coin = url.searchParams.get("coin") || "BTC";
      if (!validCoin(coin)) return json(res, 400, { error: "Unsupported market" });
      return json(res, 200, { history: await priceHistory(coin) });
    }
    if (req.method === "GET" && view === "worker") return json(res, 200, await workerStatus());
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
      const manualModel = modelEnabled("manual");
      return json(res, 200, { alerts, manualModel, jevModel: modelEnabled("jev"), scheduledModel: modelEnabled("scheduled"),
        ...(manualModel ? { manualModelName: manualModelName() } : {}), ...(alertError ? { alertError } : {}) });
    }
    if (req.method === "POST" && body?.action === "alerts" && typeof body.paused === "boolean") {
      if (!allowedChat() || !process.env.TELEGRAM_BOT_TOKEN) return json(res, 503, { error: "Telegram is not configured" });
      const { value } = await setPaused(alertStore(), body.paused);
      return json(res, 200, { alerts: publicStatus(value) });
    }
    if (req.method === "POST" && ["judge", "jev"].includes(body?.action)) {
      if (!validCoin(body.coin)) return json(res, 400, { error: "Unsupported market" });
      const jev = body.action === "jev";
      if (!modelEnabled(jev ? "jev" : "manual")) return json(res, 403, { error: "This manual model is disabled" });
      const market = await marketState(body.coin);
      const call = jev ? await signal(market.metrics, "jev") : await manualSignal(body.coin, market.metrics);
      return json(res, 200, { call, quote: call.direction ? market.quote : await quote(body.coin) });
    }
    return json(res, 404, { error: "Route unavailable" });
  } catch (error) {
    if (error instanceof GatewayError) return json(res, 503, { error: error.message });
    return json(res, 503, { error: "Could not complete the request. Check the provider and try again." });
  }
}
