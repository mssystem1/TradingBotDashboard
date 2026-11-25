import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import dashboard from "../api/dashboard.js";
import telegram from "../api/telegram.js";
import alerts from "../api/alerts.js";
import { checkAlerts } from "../lib/alerts.js";
import { createStore, setPaused } from "../lib/state.js";
import { decide, simulateFill } from "../public/strategy.js";

const password = randomBytes(32).toString("hex");
const origin = "http://127.0.0.1:8767";

async function call(handler, { url = "/", method = "GET", headers = {}, body } = {}) {
  const req = Readable.from(body ? [JSON.stringify(body)] : []);
  Object.assign(req, { url, method, headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) } });
  const result = { headers: {} };
  const res = { statusCode: 200, setHeader(name, value) { result.headers[name] = value; }, end(value) { result.body = value; } };
  await handler(req, res);
  return { ...result, status: res.statusCode };
}

test("the private dashboard requires a signed cookie and same-origin writes", async () => {
  process.env.DASHBOARD_PASSWORD = password;
  process.env.APP_ORIGIN = origin;
  delete process.env.ENABLE_MANUAL_MODEL;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  try {
    const login = await call(dashboard);
    assert.match(login.body, /Private dashboard/);
    assert.doesNotMatch(login.body, /Decision history/);
    assert.equal((await call(dashboard, { url: "/api/dashboard?view=status" })).status, 401);
    assert.equal((await call(dashboard, { method: "POST", body: { action: "login", password } })).status, 403);
    const signedIn = await call(dashboard, { method: "POST", headers: { origin }, body: { action: "login", password } });
    assert.equal(signedIn.status, 303);
    assert.match(signedIn.headers["Set-Cookie"], /HttpOnly; Path=\/; SameSite=Strict/);
    assert.equal(signedIn.headers["Cache-Control"], "private, no-store");
    const headers = { origin, cookie: signedIn.headers["Set-Cookie"].split(";")[0] };
    assert.match((await call(dashboard, { headers })).body, /Decision history/);
    const status = JSON.parse((await call(dashboard, { url: "/api/dashboard?view=status", headers })).body);
    assert.deepEqual(status, { alerts: null, manualModel: false, scheduledModel: false });
    assert.equal((await call(dashboard, { method: "POST", headers, body: { action: "judge", coin: "BTC" } })).status, 403);
    assert.equal((await call(dashboard, { method: "POST", headers: { ...headers, origin: "https://unrelated.invalid" },
      body: { action: "alerts", paused: false } })).status, 403);
  } finally {
    delete process.env.DASHBOARD_PASSWORD;
    delete process.env.APP_ORIGIN;
  }
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
