import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const SESSION_AGE = 12 * 3600;

export function sameSecret(actual, expected, minimumLength = 32) {
  if (typeof actual !== "string" || typeof expected !== "string" || expected.length < minimumLength) return false;
  const digest = value => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(actual), digest(expected));
}

function cookieName() {
  return process.env.VERCEL || process.env.APP_ORIGIN?.startsWith("https:") ? "__Host-signal_session" : "signal_session";
}

function sign(value, key) {
  return createHmac("sha256", key).update("jev-signal-lab.session:" + value).digest("base64url");
}

export function sessionCookie(key, clear = false) {
  const name = cookieName();
  const token = Math.floor(Date.now() / 1000) + SESSION_AGE + "." + randomBytes(18).toString("base64url");
  return name + "=" + (clear ? "" : token + "." + sign(token, key)) +
    "; HttpOnly; Path=/; SameSite=Lax; Max-Age=" + (clear ? 0 : SESSION_AGE) +
    (name.startsWith("__Host-") ? "; Secure" : "");
}

export function hasSession(req, key) {
  if (typeof key !== "string" || key.length < 32) return false;
  const name = cookieName() + "=";
  const cookie = (req.headers.cookie || "").split(";").map(item => item.trim()).find(item => item.startsWith(name));
  if (!cookie) return false;
  const [expires, nonce, signature, extra] = cookie.slice(name.length).split(".");
  if (extra !== undefined || !/^\d+$/.test(expires) || !/^[\w-]{24}$/.test(nonce || "")) return false;
  return Number(expires) > Date.now() / 1000 && sameSecret(signature, sign(expires + "." + nonce, key));
}

export function sameOrigin(req) {
  const origin = process.env.APP_ORIGIN || (!process.env.VERCEL ? "http://" + req.headers.host : "");
  return Boolean(origin && req.headers.origin === origin);
}

export function privacyHeaders(res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Content-Security-Policy",
    "default-src 'self'; connect-src 'self' wss://api.hyperliquid.xyz; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
}

export function json(res, status, value) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(value));
}

export function html(res, status, value) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(value);
}

export async function requestBody(req) {
  const type = String(req.headers["content-type"] || "").split(";")[0];
  if (!["application/json", "application/x-www-form-urlencoded"].includes(type)) throw new Error("Invalid body type");
  if (Number(req.headers["content-length"]) > 16384) throw new Error("Request too large");
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  let body = typeof req.body === "string" ? req.body : Buffer.isBuffer(req.body) ? req.body.toString() : "";
  if (req.body === undefined) {
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 16384) throw new Error("Request too large");
    }
  }
  return type === "application/json" ? JSON.parse(body) : Object.fromEntries(new URLSearchParams(body));
}
