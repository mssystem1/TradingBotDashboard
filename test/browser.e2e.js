import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { after, before, test } from "node:test";
import AxeBuilder from "@axe-core/playwright";
import { chromium, devices, webkit } from "playwright";

let browser;
const engine = process.env.JEV_TEST_BROWSER === "webkit" ? webkit : chromium;
const newKey = () => randomBytes(32).toString("base64url");
before(async () => {
  browser = await engine.launch({ executablePath: engine === chromium ? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH : undefined });
});
after(async () => { await browser?.close(); });

async function startApp(t, { enableModel = true, connectAlerts = true, blobUnavailable = false, configured = true,
  password = newKey(), model = "typesafe-ai/jev", gatewayDenied = false, enableJev = false, worker = false } = {}) {
  const username = "fixture-admin";
  const webhookKey = newKey();
  const jobKey = newKey();
  const child = spawn(process.execPath, ["--import", "./test/fixtures/providers.js", "scripts/dev.js"], {
    env: {
      ...process.env,
      VERCEL: "",
      PORT: "0",
      APP_ORIGIN: "",
      DASHBOARD_ADMIN_USERNAME: username,
      DASHBOARD_ADMIN_PASSWORD: configured ? password : "",
      DASHBOARD_SESSION_KEY: newKey(),
      AI_GATEWAY_API_KEY: "fixture-only",
      ENABLE_MANUAL_MODEL: String(enableModel),
      ENABLE_MANUAL_JEV: String(enableJev),
      ENABLE_SCHEDULED_MODEL: String(enableModel),
      MANUAL_SIGNAL_MODEL: model,
      FIXTURE_GATEWAY_DENIED: String(gatewayDenied),
      VERCEL_GIT_REPO_OWNER: "",
      VERCEL_GIT_REPO_SLUG: "",
      PAPER_WORKER_REPO: worker ? "mssystem1/TradingBotDashboard" : "",
      ALERT_JOB_SECRET: jobKey,
      TELEGRAM_WEBHOOK_SECRET: webhookKey,
      TELEGRAM_BOT_TOKEN: connectAlerts ? "123456:" + newKey() : "",
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
  return { origin, username, password, jobKey, webhookKey, notifications: () => notifications };
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
  await page.goto(app.origin);
  await page.getByLabel("Username").fill(app.username);
  await page.getByLabel("Password").fill(app.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Paper trading" }).waitFor();
  assert.equal(page.url(), app.origin + "/");
}

async function waitForText(locator, text) {
  await locator.filter({ hasText: text }).waitFor();
}

test("one admin can sign in with a nine-character password on a computer, tablet, and phone", async t => {
  const app = await startApp(t, { enableModel: false, password: "fixture-9" });
  const page = await pageFor(t);
  await page.goto(app.origin);
  await page.getByRole("heading", { name: "Sign in" }).waitFor();
  assert.equal(await page.getByLabel("Username").getAttribute("autocomplete"), "username");
  assert.equal(await page.getByLabel("Password").getAttribute("autocomplete"), "current-password");
  const statusURL = app.origin + "/api/dashboard?view=status";
  assert.equal((await page.request.get(statusURL)).status(), 401);
  await page.getByLabel("Username").fill(app.username);
  await page.getByLabel("Password").fill("incorrect password");
  await page.getByLabel("Password").press("Enter");
  await waitForText(page.getByRole("alert"), "Incorrect username or password");
  assert.equal(page.url(), app.origin + "/");
  await openDashboard(page, app);
  const [cookie] = await page.context().cookies();
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, "Lax");
  await waitForText(page.locator("#model-status"), "AI signals are off");
  assert.equal(await page.locator("#judge").isHidden(), true);

  const phone = await pageFor(t, devices[engine === webkit ? "iPhone 15" : "Pixel 7"]);
  const tablet = await pageFor(t, devices["iPad (gen 7)"]);
  for (const device of [phone, tablet]) {
    assert.equal((await device.request.get(statusURL)).status(), 401);
    await openDashboard(device, app);
    assert.equal((await device.request.get(statusURL)).status(), 200);
  }
  await page.getByRole("button", { name: "Sign out" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Sign in" }).waitFor();
  assert.equal((await page.request.get(statusURL)).status(), 401);
  assert.equal((await phone.request.get(statusURL)).status(), 200);
});

test("the dashboard stays locked while the owner is setting the password", async t => {
  const app = await startApp(t, { configured: false });
  const page = await pageFor(t);
  await page.goto(app.origin);
  await waitForText(page.locator("main"), "The admin password must be set in .env.local");
  assert.equal(await page.getByRole("heading", { name: "Paper trading" }).count(), 0);
  assert.equal((await page.request.get(app.origin + "/api/dashboard?view=quote")).status(), 503);
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
  await waitForText(page.locator("#history li").first(), "92%");
  await waitForText(page.locator("#position"), "Long");
  await waitForText(page.locator("#fees"), "$0.45");
  await waitForText(page.locator("#balance"), "$989.65");
  await ask.click();
  await waitForText(page.locator("#history li").first(), "Hold");
  assert.match(await page.locator("#history li").first().innerText(), /SELL/);
  await ask.click();
  await waitForText(page.locator("#history li").first(), "60%");
  assert.match(await page.locator("#history li").first().innerText(), /Hold/);
  await page.getByRole("combobox", { name: "Market", exact: true }).selectOption("ETH");
  await waitForText(page.locator("#price"), "$40");
  await waitForText(page.locator("#position"), "Flat");
  await page.getByRole("button", { name: "Refresh quote" }).click();
  await waitForText(page.locator("#price"), "$40");
  assert.deepEqual(errors, []);
});

test("paper buy, close, and sell work from snapshots on a phone with AI and Telegram off", async t => {
  const app = await startApp(t, { enableModel: false, connectAlerts: false });
  const phone = devices[engine === webkit ? "iPhone 15" : "Pixel 7"];
  const page = await pageFor(t, phone, { liveFeed: false });
  await openDashboard(page, app);
  await waitForText(page.locator("#feed-status"), "15s updates");
  await waitForText(page.locator("#model-status"), "AI signals are off");
  await waitForText(page.locator("#alert-pill"), "Setup needed");
  assert.equal(await page.locator("#judge").isHidden(), true);
  assert.equal(await page.locator("#toggle").isHidden(), true);
  const calls = [];
  page.on("request", request => {
    if (request.method() === "POST" && request.url().startsWith(app.origin + "/api/dashboard")) calls.push(request.url());
  });

  const buy = page.getByRole("button", { name: "Paper buy" });
  const close = page.getByRole("button", { name: "Close position" });
  assert.equal(await close.isDisabled(), true);
  await buy.click();
  await waitForText(page.locator("#trade-status"), "Filled at $101");
  await waitForText(page.locator("#position"), "Long");
  await waitForText(page.locator("#balance"), "$989.65");
  assert.equal(await buy.isDisabled(), true);
  await close.click();
  await waitForText(page.locator("#position"), "Flat");
  await waitForText(page.locator("#balance"), "$979.31");
  await waitForText(page.locator("#history li").first(), "Closed position");
  assert.match(await page.locator("#history li").first().innerText(), /Filled at \$99/);
  await page.getByRole("button", { name: "Paper sell" }).click();
  await waitForText(page.locator("#position"), "Short");
  await waitForText(page.locator("#history li").first(), "Filled at $99");
  assert.equal(await page.locator("#history li").count(), 3);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(calls, []);

  const market = page.getByRole("combobox", { name: "Market", exact: true });
  await market.selectOption("ETH");
  await waitForText(page.locator("#account-market"), "ETH");
  await waitForText(page.locator("#position"), "Flat");
  await market.selectOption("BTC");
  await waitForText(page.locator("#position"), "Short");
});

test("OpenAI market views appear beside the chart and leave the paper account flat", async t => {
  const app = await startApp(t, { model: "openai/gpt-4.1-mini" });
  const page = await pageFor(t);
  await openDashboard(page, app);
  await page.getByRole("region", { name: "OpenAI market view" }).getByRole("button", { name: "Ask OpenAI" }).click();
  await waitForText(page.locator("#history li").first(), "OpenAI view");
  await waitForText(page.locator("#model-status"), "The recent market moves are mixed.");
  await waitForText(page.locator("#position"), "Flat");
  await waitForText(page.locator("#fees"), "$0.00");
  await waitForText(page.locator("#jev-status"), "Jev requires paid Gateway credits");
  assert.equal(await page.locator("#ask-jev").isHidden(), true);
});

test("Jev signals run next to OpenAI and show a simulated strategy fill", async t => {
  const app = await startApp(t, { model: "openai/gpt-4.1-mini", enableJev: true });
  const page = await pageFor(t);
  await openDashboard(page, app);
  await page.getByRole("button", { name: "Ask OpenAI" }).waitFor();
  await page.getByRole("button", { name: "Ask Jev" }).click();
  await waitForText(page.locator("#history li").first(), "Jev BUY · 92% confidence");
  await waitForText(page.locator("#position"), "Long");
  await waitForText(page.locator("#jev-status"), "Paper trade added");
});

test("the signed-in dashboard shows the latest hosted price check", async t => {
  const app = await startApp(t, { worker: true });
  const page = await pageFor(t);
  await openDashboard(page, app);
  await waitForText(page.locator("#worker-pill"), "Passed");
  const latest = page.getByRole("link", { name: "View latest run" });
  assert.equal(await latest.getAttribute("href"), "https://github.com/mssystem1/TradingBotDashboard/actions/runs/12345");
});

test("Gateway routing rejection is explained and paper controls still work", async t => {
  const app = await startApp(t, { model: "openai/gpt-4.1-mini", gatewayDenied: true });
  const page = await pageFor(t);
  await openDashboard(page, app);
  await page.getByRole("button", { name: "Ask OpenAI" }).click();
  await waitForText(page.locator("#model-status"), "AI Gateway found no eligible provider for OpenAI");
  await page.getByRole("button", { name: "Paper buy" }).click();
  await waitForText(page.locator("#position"), "Long");
});

test("market snapshots and paper trades work with a four-hour device clock difference", async t => {
  const app = await startApp(t, { enableModel: false });
  const page = await pageFor(t, {}, { liveFeed: false });
  await page.clock.install({ time: new Date(Date.now() + 4 * 60 * 60_000) });
  await openDashboard(page, app);
  await waitForText(page.locator("#price"), "$100");
  await page.getByRole("button", { name: "Paper buy" }).click();
  await waitForText(page.locator("#position"), "Long");
});

test("paper fills wait for a current quote after the feed stops", async t => {
  const app = await startApp(t, { enableModel: false });
  const page = await pageFor(t, {}, { liveFeed: false });
  await page.clock.install();
  await openDashboard(page, app);
  await waitForText(page.locator("#price"), "$100");
  const buy = page.getByRole("button", { name: "Paper buy" });
  assert.equal(await buy.isEnabled(), true);
  await page.route(app.origin + "/api/dashboard?view=quote&coin=BTC", route => route.abort());
  await page.clock.fastForward(31_000);
  await waitForText(page.locator("#trade-status"), "Refresh the quote to continue trading");
  assert.equal(await buy.isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Paper sell" }).isDisabled(), true);
  assert.equal(await page.locator("#history li").count(), 0);
});

test("the chart starts with real-format history, and snapshots keep refreshing when the stream is down", async t => {
  const app = await startApp(t, { enableModel: false });
  const page = await pageFor(t, {}, { liveFeed: false });
  await page.clock.install();
  const historyURL = app.origin + "/api/dashboard?view=history&coin=BTC";
  let releaseHistory;
  const historyGate = new Promise(resolve => { releaseHistory = resolve; });
  t.after(releaseHistory);
  await page.route(historyURL, async route => {
    await historyGate;
    if (!page.isClosed()) await route.continue();
  });
  await openDashboard(page, app);
  await waitForText(page.locator("#feed-status"), "15s updates");
  await waitForText(page.locator("#price"), "$100");
  assert.equal(await page.getByRole("button", { name: "Paper buy" }).isEnabled(), true);
  const historyResponse = page.waitForResponse(response => response.url() === historyURL && response.ok());
  releaseHistory();
  await historyResponse;
  await page.waitForFunction(() => {
    const canvas = document.getElementById("chart");
    const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 150 && pixels[i + 1] > 220 && pixels[i + 2] > 160) return true;
    }
    return false;
  });
  const snapshot = page.waitForResponse(response =>
    response.url() === app.origin + "/api/dashboard?view=quote&coin=BTC" && response.ok());
  await page.clock.fastForward(16_000);
  assert.equal((await (await snapshot).json()).quote.price, 100);
});

test("a failed initial snapshot prompts a retry and the manual refresh recovers", async t => {
  const app = await startApp(t, { enableModel: false });
  const page = await pageFor(t, {}, { liveFeed: false });
  const quoteURL = app.origin + "/api/dashboard?view=quote&coin=BTC";
  await page.route(quoteURL, route => route.abort(), { times: 1 });
  await openDashboard(page, app);
  await waitForText(page.locator("#quote-time"), "Quote unavailable");
  assert.equal(await page.getByRole("button", { name: "Paper buy" }).isDisabled(), true);
  await page.getByRole("button", { name: "Refresh quote" }).click();
  await waitForText(page.locator("#price"), "$100");
  assert.equal(await page.getByRole("button", { name: "Paper buy" }).isEnabled(), true);
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
  await page.goto(app.origin);
  async function checkLayout() {
    for (const width of [1440, 810, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "page overflows at " + width);
      const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      assert.deepEqual(violations.map(v => v.id), [], "accessibility issues at " + width);
    }
  }
  await checkLayout();
  await openDashboard(page, app);
  await waitForText(page.locator("#price"), "$100");
  await checkLayout();
});

test("prices and manual calls remain available when alert storage is down", async t => {
  const app = await startApp(t, { blobUnavailable: true });
  const page = await pageFor(t);
  await openDashboard(page, app);
  await waitForText(page.locator("#price"), "$100");
  await waitForText(page.locator("#alert-pill"), "Unavailable");
  assert.equal(await page.locator("#toggle").isHidden(), true);
  await page.getByRole("button", { name: "Ask Jev" }).click();
  await waitForText(page.locator("#history li").first(), "BUY");
});
