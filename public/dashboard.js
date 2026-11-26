import { decide, simulateFill } from "./strategy.js";

const $ = id => document.getElementById(id);
const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const midpoint = new Intl.NumberFormat("en-US", { maximumFractionDigits: 5 });
const SNAPSHOT_INTERVAL_MS = 15_000;
const marketEndpoint = "/api/dashboard";
const coin = $("coin");
const books = new Map();
let socket;
let points = [];
let price = 0;
let manualModel = false;
let alerts;
let submitting = false;
let toggling = false;
let historyStarted = false;
let lastPointAt = 0;
let lastLiveAt = 0;

async function api(query, body) {
  const response = await fetch(marketEndpoint + query, body ? {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  } : { cache: "no-store" });
  if (response.status === 401) location.replace("/");
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload;
}

function currentBook() {
  return books.get(coin.value) || { cash: 0, quantity: 0, fees: 0, fills: 0, lastFillAt: 0, side: "flat" };
}

function renderBook() {
  const book = currentBook();
  const gross = book.cash + book.quantity * price;
  $("position").textContent = { flat: "Flat", buy: "Long", sell: "Short" }[book.side];
  $("gross").textContent = amount.format(gross);
  $("fees").textContent = amount.format(book.fees);
  $("net").textContent = amount.format(gross - book.fees);
  $("balance").textContent = amount.format(1000 + gross - book.fees);
}

function drawChart() {
  const canvas = $("chart");
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * ratio);
  canvas.height = Math.round(canvas.clientHeight * ratio);
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  for (let i = 0; i < 5; i++) {
    const y = (i + 0.25) * (h / 5);
    ctx.strokeStyle = "#33423a";
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  if (points.length < 2) return;
  const prices = points.map(([, value]) => value);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || max * 0.00005;
  const start = points[0][0];
  const duration = Math.max(1, points.at(-1)[0] - start);
  ctx.strokeStyle = "#a9f5c3";
  ctx.lineWidth = 2 * ratio;
  ctx.beginPath();
  points.forEach(([time, value], i) => {
    const x = (w - 2) * (time - start) / duration;
    const y = h * (0.86 - 0.72 * (value - min) / span);
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  });
  ctx.stroke();
}

function showQuote(latestPrice, at) {
  if (!Number.isFinite(latestPrice) || latestPrice <= 0 || at < lastPointAt) return;
  price = latestPrice;
  $("price").textContent = "$" + midpoint.format(price);
  $("quote-time").textContent = "Observed " + new Date(at).toLocaleTimeString();
  if (at - lastPointAt >= 150) {
    lastPointAt = at;
    points.push([at, price]);
    if (points.length > 350) points.shift();
    drawChart();
  }
  renderBook();
}

function feedStatus(text, active = false) {
  $("feed-status").textContent = text;
  $("feed-status").classList.toggle("neutral", !active);
}

function hasLiveFeed() {
  return socket?.readyState === WebSocket.OPEN && Date.now() - lastLiveAt < SNAPSHOT_INTERVAL_MS;
}

async function refreshQuote(withHistory = false) {
  const selected = coin.value;
  try {
    const { quote, history } = await api("?view=quote&coin=" + selected + (withHistory ? "&history=1" : ""));
    if (selected !== coin.value) return;
    if (Array.isArray(history) && history.length) {
      const earliest = points[0]?.[0] ?? quote.time;
      points = history.filter(([time]) => time < earliest).concat(points);
      drawChart();
    }
    if (quote.time >= lastPointAt) showQuote(quote.price, quote.time);
    if (!hasLiveFeed()) feedStatus("Snapshot");
  } catch {
    if (!hasLiveFeed()) feedStatus("Feed unavailable");
  }
}

function connect() {
  const selected = coin.value;
  socket?.close();
  const next = new WebSocket("wss://api.hyperliquid.xyz/ws");
  socket = next;
  let ping;
  next.addEventListener("open", () => {
    next.send(JSON.stringify({ method: "subscribe", subscription: { type: "bbo", coin: selected } }));
    ping = setInterval(() => {
      if (next.readyState === WebSocket.OPEN) next.send(JSON.stringify({ method: "ping" }));
    }, 30_000);
  });
  next.addEventListener("message", event => {
    if (next !== socket) return;
    try {
      const { channel, data } = JSON.parse(event.data);
      if (channel !== "bbo" || data.coin !== selected || !data.bbo?.every(Boolean)) return;
      const [bid, ask] = data.bbo;
      const value = (Number(bid.px) + Number(ask.px)) / 2;
      if (!Number.isFinite(value) || value <= 0) return;
      lastLiveAt = Date.now();
      showQuote(value, data.time || lastLiveAt);
      feedStatus("Live", true);
    } catch { /* Skip malformed exchange messages. */ }
  });
  next.addEventListener("close", () => {
    clearInterval(ping);
    if (next !== socket) return;
    feedStatus(price > 0 ? "Snapshot" : "Reconnecting");
    setTimeout(() => {
      if (next === socket) connect();
    }, 5000);
  });
}

function renderAlerts(scheduledModel) {
  if (!alerts) {
    $("alert-pill").textContent = "Setup needed";
    $("alert-note").textContent = "Connect your private Telegram bot and alert storage.";
    $("toggle").disabled = true;
    return;
  }
  $("alert-pill").textContent = alerts.paused ? "Paused" : "Enabled";
  $("alert-pill").classList.toggle("neutral", alerts.paused);
  $("toggle").textContent = alerts.paused ? "Resume alerts" : "Pause alerts";
  $("toggle").disabled = toggling;
  $("alert-note").textContent = !scheduledModel ? "Scheduled Jev calls are off." :
    alerts.lastAlertAt ? "Last alert " + new Date(alerts.lastAlertAt).toLocaleString() :
    "Use /pause or /resume in your private bot chat.";
}

async function refreshStatus() {
  try {
    const status = await api("?view=status");
    manualModel = status.manualModel;
    $("judge").disabled = !manualModel || submitting;
    if (!manualModel) $("model-status").textContent = "Jev calls are off. Live prices remain available.";
    alerts = status.alerts;
    if (status.alertError) {
      $("alert-pill").textContent = "Unavailable";
      $("alert-note").textContent = "Could not read alerts. Use Sync status to retry.";
      $("toggle").disabled = true;
      return;
    }
    renderAlerts(status.scheduledModel);
  } catch {
    $("alert-pill").textContent = "Unavailable";
    $("alert-note").textContent = "Could not read alerts. Use Sync status to retry.";
    $("toggle").disabled = true;
  }
}

function logDecision(selected, call, action) {
  const tbody = $("history");
  if (!historyStarted) {
    tbody.replaceChildren();
    historyStarted = true;
  }
  const row = tbody.insertRow(0);
  for (const value of [new Date().toLocaleTimeString(), selected, call.side.toUpperCase(),
    Math.round(call.confidence * 100) + "%", call.latencyMs + " ms", action.toUpperCase()]) {
    row.insertCell().textContent = value;
  }
  if (tbody.rows.length > 30) tbody.deleteRow(-1);
}

$("judge").addEventListener("click", async () => {
  const selected = coin.value;
  submitting = true;
  $("judge").disabled = true;
  coin.disabled = true;
  $("model-status").textContent = "Waiting for Jev…";
  try {
    const { call, quote } = await api("", { action: "judge", coin: selected });
    const now = Date.now();
    const book = currentBook();
    const action = call.latencyMs > 5000 ? "hold" : decide(call, book.side, now - book.lastFillAt);
    books.set(selected, simulateFill(book, action, quote, now));
    if (quote.time >= lastPointAt) showQuote(quote.price, quote.time);
    renderBook();
    logDecision(selected, call, action);
    $("model-status").textContent = call.latencyMs > 5000 ? "Late answer. Paper position held." : "";
  } catch (error) {
    $("model-status").textContent = error.message;
  } finally {
    submitting = false;
    $("judge").disabled = !manualModel;
    coin.disabled = false;
  }
});

$("toggle").addEventListener("click", async () => {
  if (!alerts || toggling) return;
  toggling = true;
  $("toggle").disabled = true;
  try {
    await api("", { action: "alerts", paused: !alerts.paused });
    toggling = false;
    await refreshStatus();
  } catch (error) {
    toggling = false;
    $("alert-note").textContent = error.message;
    $("toggle").disabled = false;
  }
});

coin.addEventListener("change", () => {
  points = [];
  lastPointAt = 0;
  lastLiveAt = 0;
  price = 0;
  $("price").textContent = "—";
  $("quote-time").textContent = "Waiting for a market quote";
  feedStatus("Connecting");
  drawChart();
  refreshQuote(true);
  connect();
});
$("refresh").addEventListener("click", () => refreshQuote());
$("sync-status").addEventListener("click", refreshStatus);
window.addEventListener("resize", drawChart);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    refreshStatus();
    if (!hasLiveFeed()) refreshQuote();
  }
});
setInterval(() => {
  if (!document.hidden && !hasLiveFeed()) refreshQuote();
}, SNAPSHOT_INTERVAL_MS);
drawChart();
connect();
refreshQuote(true);
refreshStatus();
