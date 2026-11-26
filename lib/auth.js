import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { sameSecret } from "./http.js";

export const MIN_PASSWORD_LENGTH = 9;
export const MAX_PASSWORD_LENGTH = 128;
const MAX_FAILURES = 10;
const FAILURE_WINDOW = 5 * 60_000;
const failures = new Map();

export function dashboardAdmin() {
  const username = process.env.DASHBOARD_ADMIN_USERNAME || "admin";
  const password = process.env.DASHBOARD_ADMIN_PASSWORD || "";
  const secret = process.env.DASHBOARD_SESSION_KEY || "";
  if (!password) return { setupIssue: "passwordMissing" };
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH)
    return { setupIssue: "passwordLength" };
  if (!password.trim() || /[\r\n]/.test(password)) return { setupIssue: "passwordFormat" };
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(username)) return { setupIssue: "username" };
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(secret)) return { setupIssue: "sessionKey" };
  if (process.env.VERCEL) {
    const url = URL.parse(process.env.APP_ORIGIN || "");
    if (url?.protocol !== "https:" || url.origin !== process.env.APP_ORIGIN) return { setupIssue: "origin" };
  }

  const sessionKey = createHmac("sha256", secret).update("jev-signal-lab.admin.v1:")
    .update(JSON.stringify([username, password])).digest("base64url");
  return {
    admin: {
      sessionKey,
      accepts(input) {
        const userMatches = sameSecret(input.username, username, 1);
        const passwordMatches = sameSecret(input.password, password, MIN_PASSWORD_LENGTH);
        return userMatches && passwordMatches;
      },
    },
  };
}

// This limit is per running server instance. The password should also be unique and hard to guess.
export function trySignIn(req, admin, credentials) {
  const forwarded = process.env.VERCEL && req.headers["x-vercel-forwarded-for"];
  const address = typeof forwarded === "string" && isIP(forwarded) ? forwarded : req.socket?.remoteAddress || "unknown";
  const now = Date.now();
  let attempt = failures.get(address);
  if (attempt?.until <= now) {
    failures.delete(address);
    attempt = undefined;
  }
  if (attempt?.count >= MAX_FAILURES) return { retryAfter: Math.ceil((attempt.until - now) / 1000) };
  if (admin.accepts(credentials)) {
    failures.delete(address);
    return { signedIn: true };
  }
  if (attempt) attempt.count++;
  else {
    if (failures.size >= 2048) failures.delete(failures.keys().next().value);
    failures.set(address, { count: 1, until: now + FAILURE_WINDOW });
  }
  return { signedIn: false };
}
