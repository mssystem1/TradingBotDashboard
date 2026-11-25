import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { after, before, test } from "node:test";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

let browser;
const newKey = () => randomBytes(32).toString("base64url");
before(async () => {
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
});
after(async () => { await browser?.close(); });

async function startApp(t, { enableModel = true, blobUnavailable = false } = {}) {
  const key = newKey();
  const webhookKey = newKey();
  const jobKey = newKey();
  const child = spawn(process.execPath, ["--import", "./test/fixtures/providers.js", "scripts/dev.js"], {
    env: {
      ...process.env,
      VERCEL: "",
      PORT: "0",
      APP_ORIGIN: "",
      DASHBOARD_ACCESS_KEY: key,
      AI_GATEWAY_API_KEY: "fixture-only",
      ENABLE_MANUAL_MODEL: String(enableModel),
      ENABLE_SCHEDULED_MODEL: String(enableModel),
      ALERT_JOB_SECRET: jobKey,
      TELEGRAM_WEBHOOK_SECRET: webhookKey,
      TELEGRAM_BOT_TOKEN: "123456:" + newKey(),
      TELEGRAM_CHAT_ID: "123456789",
      BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_fixture_testonly",
      FIXTURE_BLOB_UNAVAILABLE: String(blobUnavailable),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill());
  const lines = createInterface({ input: child.stdout });
  let notifications = 0;
  lines.on("line", line => { if (line === "Fixture Telegram notification") notifications++; });
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The fixture app did not start")), 10_000);
    child.once("exit", code => {
      clearTimeout(timer);
      reject(new Error("The fixture app exited with code " + code));
    });
    child.once("error", reject);
    lines.on("line", line => {
      const match = line.match(/^Private local web app at (http:\/\/127\.0\.0\.1:\d+)$/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });
  return { origin, key, jobKey, webhookKey, notifications: () => notifications };
}

async function pageFor(t, options, { liveFeed = true } = {}) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  page.setDefaultTimeout(8_000);
  t.after(() => context.close());
  await page.routeWebSocket("wss://api.hyperliquid.xyz/ws", route => {
    if (!liveFeed) return route.close();
    route.onMessage(message => {
      const { method, subscription } = JSON.parse(message.toString());
      if (method !== "subscribe") return;
      const { coin } = subscription;
      const price = { BTC: 100, ETH: 40, HYPE: 10 }[coin];
      route.send(JSON.stringify({ channel: "bbo", data: {
        coin, time: Date.now(), bbo: [{ px: price - 1 }, { px: price + 1 }],
      } }));
    });
  });
  return page;
}

async function openDashboard(page, app) {
  await page.goto(app.origin + "/#access=" + app.key);
  await page.getByRole("heading", { name: "Paper trading" }).waitFor();
  assert.equal(new URL(page.url()).hash, "");
}

async function waitForText(locator, text) {
  await locator.filter({ hasText: text }).waitFor();
}

test("a private link opens directly, removes the key from the address, and can be locked", async t => {
  const app = await startApp(t, { enableModel: false });
  const page = await pageFor(t);
  await page.goto(app.origin);
  await page.getByRole("heading", { name: "Private dashboard" }).waitFor();
  assert.equal(await page.locator("input[type=password]").count(), 0);
  const statusURL = app.origin + "/api/dashboard?view=status";
  assert.equal((await page.request.get(statusURL)).status(), 401);
  await page.goto(app.origin + "/#access=" + newKey());
  await waitForText(page.locator("#access-status"), "invalid");
  assert.equal(new URL(page.url()).hash, "");
  await openDashboard(page, app);
  const [cookie] = await page.context().cookies();
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, "Strict");
  await waitForText(page.locator("#model-status"), "Jev calls are off");
  assert.equal(await page.getByRole("button", { name: "Ask Jev" }).isDisabled(), true);
  const lock = page.getByRole("button", { name: "Lock dashboard" });
  await lock.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Private dashboard" }).waitFor();
  assert.equal((await page.request.get(statusURL)).status(), 401);
});

test("market switching, buy, cooldown, low confidence, and paper fees work in the browser", async t => {
  const app = await startApp(t);
  const page = await pageFor(t);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await openDashboard(page, app);
  await waitForText(page.locator("#price"), "$100");
  await waitForText(page.locator("#feed-status"), "Live");
  const ask = page.getByRole("button", { name: "Ask Jev" });
  await ask.click();
  await waitForText(page.locator("#history tr").first(), "92%");
  await waitForText(page.locator("#position"), "Long");
  await waitForText(page.locator("#fees"), "$0.45");
  await waitForText(page.locator("#balance"), "$989.65");
  await ask.click();
  await waitForText(page.locator("#history tr").first(), "HOLD");
  assert.match(await page.locator("#history tr").first().innerText(), /SELL/);
  await ask.click();
  await waitForText(page.locator("#history tr").first(), "60%");
  assert.match(await page.locator("#history tr").first().innerText(), /HOLD/);
  await page.getByLabel("Market").selectOption("ETH");
  await waitForText(page.locator("#price"), "$40");
  await waitForText(page.locator("#position"), "Flat");
  await page.getByRole("button", { name: "Refresh quote" }).click();
  await waitForText(page.locator("#price"), "$40");
  assert.deepEqual(errors, []);
});

test("the chart starts with real-format history, and snapshots keep refreshing when the stream is down", async t => {
  const app = await startApp(t, { enableModel: false });
  const page = await pageFor(t, {}, { liveFeed: false });
  await page.clock.install();
  await openDashboard(page, app);
  await waitForText(page.locator("#feed-status"), "Snapshot");
  await waitForText(page.locator("#price"), "$100");
  const chartHasLine = await page.locator("#chart").evaluate(canvas => {
    const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 150 && pixels[i + 1] > 220 && pixels[i + 2] > 160) return true;
    }
    return false;
  });
  assert.ok(chartHasLine, "completed candles should fill in the chart before a second quote");
  const snapshot = page.waitForResponse(response =>
    response.url() === app.origin + "/api/dashboard?view=quote&coin=BTC" && response.ok());
  await page.clock.fastForward(16_000);
  assert.equal((await (await snapshot).json()).quote.price, 100);
});

test("Telegram and the dashboard share pause state, and a scheduled check sends at most once", async t => {
  const app = await startApp(t);
  const page = await pageFor(t);
  await openDashboard(page, app);
  await waitForText(page.locator("#alert-pill"), "Paused");
  const tick = async () => {
    const response = await page.request.post(app.origin + "/api/alerts", {
      headers: { Authorization: "Bearer " + app.jobKey },
    });
    assert.equal(response.status(), 200);
    return (await response.json()).result;
  };
  assert.equal(await tick(), "paused");
  const eventTime = Math.floor(Date.now() / 1000);
  const telegram = (command, id, user = 123456789) => page.request.post(app.origin + "/api/telegram", {
    headers: { "X-Telegram-Bot-Api-Secret-Token": app.webhookKey },
    data: { update_id: id, message: {
      date: eventTime, from: { id: user }, chat: { type: "private", id: user }, text: command,
    } },
  });
  assert.equal((await telegram("/resume", 100, 123456788)).status(), 200);
  assert.equal(await tick(), "paused");
  assert.equal((await telegram("/resume", 101)).status(), 200);
  await page.getByRole("button", { name: "Sync status" }).click();
  await waitForText(page.locator("#alert-pill"), "Enabled");
  const results = await Promise.all([tick(), tick()]);
  assert.deepEqual(results.sort(), ["already checked or daily limit reached", "sent"]);
  await page.getByRole("button", { name: "Pause alerts" }).click();
  await waitForText(page.locator("#alert-pill"), "Paused");
  assert.equal((await telegram("/resume", 101)).status(), 200);
  assert.equal(await tick(), "paused");
  await page.getByRole("button", { name: "Resume alerts" }).click();
  await waitForText(page.locator("#alert-pill"), "Enabled");
  assert.equal((await telegram("/pause", 102)).status(), 200);
  await page.getByRole("button", { name: "Sync status" }).click();
  await waitForText(page.locator("#alert-pill"), "Paused");
  assert.equal(app.notifications(), 3);
});

test("desktop, tablet, and phone layouts have readable controls and pass automated accessibility checks", async t => {
  const app = await startApp(t);
  const page = await pageFor(t);
  await openDashboard(page, app);
  await waitForText(page.locator("#price"), "$100");
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("heading", { name: "Paper account" }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "page overflows at " + width);
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    assert.deepEqual(violations.map(v => v.id), [], "accessibility issues at " + width);
  }
});

test("prices and manual calls remain available when alert storage is down", async t => {
  const app = await startApp(t, { blobUnavailable: true });
  const page = await pageFor(t);
  await openDashboard(page, app);
  await waitForText(page.locator("#price"), "$100");
  await waitForText(page.locator("#alert-pill"), "Unavailable");
  assert.equal(await page.getByRole("button", { name: "Resume alerts" }).isDisabled(), true);
  await page.getByRole("button", { name: "Ask Jev" }).click();
  await waitForText(page.locator("#history tr").first(), "BUY");
});
