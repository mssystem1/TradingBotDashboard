import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import dashboard from "../api/dashboard.js";
import telegram from "../api/telegram.js";
import alerts from "../api/alerts.js";
import { checkAlerts } from "../lib/alerts.js";
import { sessionCookie } from "../lib/http.js";
import { createStore, setPaused } from "../lib/state.js";
import { decide, simulateFill } from "../public/strategy.js";

const sessionKey = randomBytes(32).toString("base64url");
const password = randomBytes(24).toString("base64url");
const username = "fixture-admin";
const origin = "https://dashboard.example";

async function call(handler, { url = "/", method = "GET", headers = {}, body, address = "192.0.2.1" } = {}) {
  const form = body instanceof URLSearchParams;
  const req = Readable.from(body ? [form ? body.toString() : JSON.stringify(body)] : []);
  const contentType = form ? "application/x-www-form-urlencoded" : "application/json";
  Object.assign(req, { url, method, socket: { remoteAddress: address }, headers: { ...headers, ...(body ? { "content-type": contentType } : {}) } });
  const result = { headers: {} };
  const res = { statusCode: 200, setHeader(name, value) { result.headers[name] = value; }, end(value) { result.body = value; } };
  await handler(req, res);
  return { ...result, status: res.statusCode };
}

function adminEnvironment(t, overrides = {}) {
  const values = { VERCEL: "1", APP_ORIGIN: origin, DASHBOARD_ADMIN_USERNAME: username,
    DASHBOARD_ADMIN_PASSWORD: password, DASHBOARD_SESSION_KEY: sessionKey, ENABLE_MANUAL_MODEL: "false",
    ENABLE_SCHEDULED_MODEL: "false", BLOB_READ_WRITE_TOKEN: "", ...overrides };
  for (const [name, value] of Object.entries(values)) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
  }
}

function signIn({ headers = { origin }, address, ...credentials } = {}) {
  const body = new URLSearchParams({ action: "login", username, password, ...credentials });
  return call(dashboard, { method: "POST", headers, body, address });
}

test("only the admin form creates a signed session and browser writes require the same origin", async t => {
  adminEnvironment(t);
  const entry = await call(dashboard);
  assert.match(entry.body, /<h1>Sign in<\/h1>/);
  assert.match(entry.body, /type="password"/);
  assert.doesNotMatch(entry.body, /Practice a trade/);
  assert.ok(!entry.body.includes(password));
  assert.equal((await call(dashboard, { url: "/api/dashboard?view=status" })).status, 401);
  assert.equal((await signIn({ headers: {} })).status, 403);
  const badPassword = await signIn({ password: "wrong" });
  assert.equal(badPassword.status, 401);
  assert.match(badPassword.body, /Incorrect username or password/);
  assert.equal(badPassword.headers["Set-Cookie"], undefined);
  assert.equal((await signIn({ username: "someone-else" })).status, 401);
  assert.equal((await call(dashboard, { method: "POST", headers: { origin },
    body: { action: "open", key: sessionKey } })).status, 401);

  const opened = await signIn();
  assert.equal(opened.status, 303);
  assert.equal(opened.headers.Location, "/");
  assert.match(opened.headers["Set-Cookie"], /^__Host-signal_session=.*; HttpOnly; Path=\/; SameSite=Lax; Max-Age=43200; Secure$/);
  assert.equal(opened.headers["Cache-Control"], "private, no-store");
  const headers = { origin, cookie: opened.headers["Set-Cookie"].split(";")[0] };
  assert.match((await call(dashboard, { headers })).body, /Practice a trade/);
  const status = JSON.parse((await call(dashboard, { url: "/api/dashboard?view=status", headers })).body);
  assert.deepEqual(status, { alerts: null, manualModel: false, scheduledModel: false });
  assert.equal((await call(dashboard, { method: "POST", headers, body: { action: "judge", coin: "BTC" } })).status, 403);
  assert.equal((await call(dashboard, { method: "POST", headers: { ...headers, origin: "https://unrelated.invalid" },
    body: { action: "alerts", paused: false } })).status, 403);
  const signedOut = await call(dashboard, { method: "POST", headers, body: new URLSearchParams({ action: "logout" }) });
  assert.equal(signedOut.status, 303);
  assert.match(signedOut.headers["Set-Cookie"], /^__Host-signal_session=;.*Max-Age=0; Secure$/);
});

test("missing production settings keep the dashboard locked and changing the password invalidates old sessions", async t => {
  adminEnvironment(t, { DASHBOARD_ADMIN_PASSWORD: "" });
  const pending = await call(dashboard);
  assert.match(pending.body, /The admin password must be set in Vercel/);
  assert.doesNotMatch(pending.body, /Practice a trade|type="password"/);
  assert.equal((await signIn()).status, 503);
  assert.equal((await call(dashboard, { url: "/api/dashboard?view=status" })).status, 503);

  process.env.DASHBOARD_ADMIN_PASSWORD = password;
  const opened = await signIn();
  const cookie = opened.headers["Set-Cookie"].split(";")[0];
  const legacyCookie = sessionCookie(sessionKey).split(";")[0];
  assert.match((await call(dashboard, { headers: { cookie: legacyCookie } })).body, /<h1>Sign in<\/h1>/);
  assert.match((await call(dashboard, { headers: { cookie } })).body, /Practice a trade/);
  const nextPassword = randomBytes(24).toString("base64url");
  process.env.DASHBOARD_ADMIN_PASSWORD = nextPassword;
  assert.match((await call(dashboard, { headers: { cookie } })).body, /<h1>Sign in<\/h1>/);
  assert.equal((await call(dashboard, { url: "/api/dashboard?view=status", headers: { cookie } })).status, 401);
  assert.equal((await signIn()).status, 401);
  assert.equal((await signIn({ password: nextPassword })).status, 303);
});

test("the setup page identifies invalid settings without revealing their values", async t => {
  adminEnvironment(t);
  const cases = [
    ["DASHBOARD_ADMIN_PASSWORD", "tooShort", /password in Vercel must be 9 to 128 characters/],
    ["DASHBOARD_ADMIN_PASSWORD", "x".repeat(129), /password in Vercel must be 9 to 128 characters/],
    ["DASHBOARD_ADMIN_PASSWORD", "test-line-one\ntest-line-two", /password in Vercel must be on one line/],
    ["DASHBOARD_ADMIN_USERNAME", "invalid fixture account", /admin username in Vercel/],
    ["DASHBOARD_SESSION_KEY", "short-key-fixture", /session signing key in Vercel/],
    ["APP_ORIGIN", "https://trailing.example/", /must be an HTTPS origin/],
  ];
  for (const [name, value, message] of cases) {
    const previous = process.env[name];
    process.env[name] = value;
    try {
      const page = await call(dashboard);
      assert.match(page.body, message);
      assert.ok(!page.body.includes(value));
      assert.doesNotMatch(page.body, /type="password"|Practice a trade/);
      assert.equal((await call(dashboard, { url: "/api/dashboard?view=status" })).status, 503);
    } finally {
      process.env[name] = previous;
    }
  }
});

test("repeated sign-in failures throttle the source address", async t => {
  adminEnvironment(t);
  const address = "192.0.2.70";
  for (let i = 0; i < 10; i++) assert.equal((await signIn({ address, password: "wrong" })).status, 401);
  const throttled = await signIn({ address });
  assert.equal(throttled.status, 429);
  assert.ok(Number(throttled.headers["Retry-After"]) > 0);
  assert.equal(throttled.headers["Set-Cookie"], undefined);
  assert.equal((await signIn({ address: "192.0.2.71" })).status, 303);
});

test("Telegram and the scheduled job reject unauthenticated requests", async () => {
  assert.equal((await call(telegram, { method: "POST", body: { message: { text: "/resume" } } })).status, 401);
  assert.equal((await call(alerts, { method: "POST" })).status, 401);
});

function memoryStore(paused = true) {
  let value = {
    paused, changedAt: null, lastSlot: null, callDate: null, callsToday: 0, lastSide: null,
    lastAlertAt: null, telegramLastUpdate: null, telegramLastDate: null,
  };
  let version = 0;
  return createStore({
    async read() { return { value, version }; },
    async write(next, expected) {
      if (version !== expected) return false;
      value = next;
      version++;
      return true;
    },
  });
}

test("web and Telegram share pause state, and a duplicate command cannot undo a web pause", async () => {
  const store = memoryStore();
  await setPaused(store, false, { id: 11, date: 5 });
  assert.equal((await store.current()).paused, false);
  await setPaused(store, true);
  assert.equal((await setPaused(store, false, { id: 11, date: 5 })).changed, false);
  assert.equal((await store.current()).paused, true);
  assert.equal((await setPaused(store, false, { id: 12, date: 6 })).changed, true);
});

test("the runner reserves only one call per slot and stops sending after a pause", async () => {
  const store = memoryStore();
  let time = Date.UTC(2026, 10, 25, 15);
  let calls = 0;
  let sent = 0;
  const args = {
    store, clock: () => time, limit: 24, coin: "BTC",
    marketState: async () => ({ quote: { price: 100 }, metrics: {} }),
    signal: async () => { calls++; return { side: "buy", confidence: 0.9, latencyMs: 100 }; },
    send: async () => { sent++; },
  };
  assert.equal(await checkAlerts(args), "paused");
  await setPaused(store, false);
  await Promise.all([checkAlerts(args), checkAlerts(args)]);
  assert.deepEqual([calls, sent], [1, 1]);
  time += 15 * 60_000;
  assert.equal(await checkAlerts(args), "already checked or daily limit reached");
  time += 45 * 60_000;
  assert.equal(await checkAlerts(args), "unchanged signal");
  time += 60 * 60_000;
  assert.equal(await checkAlerts({ ...args, signal: async () => {
    await setPaused(store, true);
    return { side: "sell", confidence: 0.95, latencyMs: 100 };
  } }), "pause changed");
  assert.equal(sent, 1);
});

test("paper entry and exit use the spread and count the fee on each side", () => {
  assert.equal(decide({ side: "buy", confidence: 0.84 }, "flat", 20_000), "hold");
  assert.equal(decide({ side: "buy", confidence: 0.85 }, "flat", 14_999), "hold");
  assert.equal(decide({ side: "buy", confidence: 0.85 }, "flat", 15_000), "buy");
  const quote = { bid: 99, ask: 100 };
  const opened = simulateFill({ quantity: 0, cash: 0, fees: 0, fills: 0 }, "buy", quote, 0);
  const closed = simulateFill(opened, "flat", quote, 20_000);
  assert.equal(closed.quantity, 0);
  assert.equal(closed.cash, -10);
  assert.equal(closed.fills, 2);
  assert.ok(Math.abs(closed.fees - 0.8955) < 1e-8);
});
