import { decide, simulateFill } from "./strategy.js";

const $ = id => document.getElementById(id);
const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const midpoint = new Intl.NumberFormat("en-US", { maximumFractionDigits: 5 });
const SNAPSHOT_INTERVAL_MS = 15_000;
const MAX_FILL_QUOTE_AGE_MS = 30_000;
const marketEndpoint = "/api/dashboard";
const coin = $("coin");
const books = new Map();
const pendingQuotes = new Set();
const paperButtons = document.querySelectorAll("[data-paper-action]");
const actionLabels = { buy: "Paper buy", sell: "Paper sell", flat: "Closed position", hold: "Hold" };
let socket;
let points = [];
let latestQuote;
let quoteExpiry;
let tradeReceipt = "";
let manualModel = false;
let manualName = "Jev";
let alerts;
let submitting = false;
let toggling = false;
let lastPointAt = 0;
let lastLiveAt = -Infinity;
let clockTime = Number(document.querySelector(".workspace").dataset.serverTime) || Date.now();
let clockReadAt = performance.now();

function marketTime() {
  return clockTime + performance.now() - clockReadAt;
}

async function api(query, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), body ? 28_000 : 10_000);
  try {
    const request = body ? {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    } : { cache: "no-store" };
    const response = await fetch(marketEndpoint + query, { ...request, signal: controller.signal });
    const responseTime = Date.parse(response.headers.get("date") || "");
    if (Number.isFinite(responseTime)) {
      clockTime = Math.max(marketTime(), responseTime);
      clockReadAt = performance.now();
    }
    if (response.status === 401) location.replace("/");
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Request failed.");
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function currentBook() {
  return books.get(coin.value) || { cash: 0, quantity: 0, fees: 0, fills: 0, lastFillAt: 0, side: "flat" };
}

function hasCurrentQuote() {
  return latestQuote && marketTime() - latestQuote.time < MAX_FILL_QUOTE_AGE_MS;
}

function renderTradeControls() {
  const ready = hasCurrentQuote();
  const book = currentBook();
  for (const button of paperButtons) {
    button.disabled = !ready || submitting || button.dataset.paperAction === book.side;
  }
  const hint = !latestQuote ? "Waiting for a current quote." : "Refresh the quote to continue trading.";
  const status = submitting ? `Waiting for the ${manualName} signal…` :
    ready ? tradeReceipt || "Choose Paper buy or Paper sell to start." : hint;
  if ($("trade-status").textContent !== status) $("trade-status").textContent = status;
}

function renderBook() {
  const book = currentBook();
  const gross = book.cash + book.quantity * (latestQuote?.price ?? 0);
  const canMark = book.quantity === 0 || latestQuote;
  $("account-market").textContent = coin.value;
  $("position").textContent = { flat: "Flat", buy: "Long", sell: "Short" }[book.side];
  $("gross").textContent = canMark ? amount.format(gross) : "—";
  $("fees").textContent = amount.format(book.fees);
  $("net").textContent = canMark ? amount.format(gross - book.fees) : "—";
  $("balance").textContent = canMark ? amount.format(1000 + gross - book.fees) : "—";
  renderTradeControls();
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

function showQuote({ coin: market, bid, ask, time }) {
  if (market !== coin.value || ![bid, ask, time].every(Number.isFinite) || bid <= 0 || ask < bid ||
      Math.abs(marketTime() - time) > 60_000) return false;
  if (time < (latestQuote?.time ?? 0)) return true;
  const price = (bid + ask) / 2;
  latestQuote = { coin: market, bid, ask, price, time };
  $("price").textContent = "$" + midpoint.format(price);
  $("quote-time").textContent = "Updated " + new Date(time).toLocaleTimeString();
  if (time - lastPointAt >= 150) {
    lastPointAt = time;
    points.push([time, price]);
    if (points.length > 350) points.shift();
    drawChart();
  }
  clearTimeout(quoteExpiry);
  quoteExpiry = setTimeout(() => {
    renderTradeControls();
    if (!hasLiveFeed()) feedStatus("Quote stale");
  }, Math.max(0, time + MAX_FILL_QUOTE_AGE_MS - marketTime()));
  renderBook();
  return true;
}

function feedStatus(text, active = false) {
  $("feed-status").textContent = text;
  $("feed-status").classList.toggle("neutral", !active);
}

function hasLiveFeed() {
  return socket?.readyState === WebSocket.OPEN && performance.now() - lastLiveAt < SNAPSHOT_INTERVAL_MS;
}

async function refreshQuote() {
  const selected = coin.value;
  if (pendingQuotes.has(selected)) return;
  pendingQuotes.add(selected);
  $("refresh").disabled = true;
  try {
    const { quote } = await api("?view=quote&coin=" + selected);
    if (selected !== coin.value) return;
    if (!showQuote(quote)) throw new Error("Invalid or expired quote");
    if (!hasLiveFeed()) feedStatus(hasCurrentQuote() ? "15s updates" : "Quote stale");
  } catch {
    if (selected === coin.value && !hasLiveFeed()) {
      feedStatus("Retrying");
      if (!latestQuote) $("quote-time").textContent = "Quote unavailable. Refresh now or wait for the next retry.";
    }
  } finally {
    pendingQuotes.delete(selected);
    if (selected === coin.value) $("refresh").disabled = false;
  }
}

async function refreshHistory() {
  const selected = coin.value;
  try {
    const { history } = await api("?view=history&coin=" + selected);
    if (selected !== coin.value) return;
    if (Array.isArray(history) && history.length) {
      const earliest = points[0]?.[0] ?? Infinity;
      points = history.filter(([time]) => time < earliest).concat(points);
      drawChart();
    }
  } catch {
    // Current quotes and paper fills can continue without historical candles.
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
      if (channel !== "bbo" || data.coin !== selected || data.bbo?.length !== 2 || !data.bbo.every(Boolean)) return;
      const [bid, ask] = data.bbo;
      if (!showQuote({ coin: selected, bid: Number(bid.px), ask: Number(ask.px), time: data.time })) return;
      if (marketTime() - data.time >= MAX_FILL_QUOTE_AGE_MS) return;
      lastLiveAt = performance.now();
      feedStatus("Live", true);
    } catch { /* Skip malformed exchange messages. */ }
  });
  next.addEventListener("close", () => {
    clearInterval(ping);
    if (next !== socket) return;
    if (hasCurrentQuote()) feedStatus("15s updates");
    else if (!latestQuote && $("feed-status").textContent === "Connecting") feedStatus("Reconnecting");
    setTimeout(() => {
      if (next === socket) connect();
    }, 5000);
  });
}

function renderModel(enabled, name = "Jev", unavailable = false) {
  manualModel = enabled;
  manualName = name;
  $("model-heading").textContent = enabled ? `${name} signals` : "AI signals";
  $("judge").textContent = `Ask ${name}`;
  $("judge").hidden = !enabled;
  $("judge").disabled = !enabled || submitting;
  $("model-pill").textContent = unavailable ? "Unavailable" : enabled ? "Ready" : "Off";
  $("model-pill").classList.toggle("neutral", !enabled);
  if (!submitting) {
    $("model-status").textContent = enabled ? (name === "Jev" ?
      "Request a 15-minute signal. The strategy decides whether to make a paper trade." :
      "Request a 15-minute market view. Use the paper controls to act on it.") :
      unavailable ? "Could not check AI signals. Paper trades are still available." : "AI signals are off. You can practice trades above.";
  }
}

function renderAlerts(status) {
  alerts = status.alerts;
  const toggle = $("toggle");
  toggle.hidden = !alerts;
  toggle.disabled = !alerts || toggling;
  $("sync-status").hidden = !alerts && !status.alertError;
  $("alert-pill").classList.toggle("neutral", !alerts || alerts.paused);
  if (!alerts) {
    $("alert-pill").textContent = status.alertError ? "Unavailable" : "Setup needed";
    $("alert-note").textContent = status.alertError ? "Could not read the alert status. Use Sync status to retry." :
      "Connect a private Telegram bot to receive alerts.";
    return;
  }
  $("alert-pill").textContent = alerts.paused ? "Paused" : "Enabled";
  toggle.textContent = alerts.paused ? "Resume alerts" : "Pause alerts";
  $("alert-note").textContent = !status.scheduledModel ? "Scheduled Jev calls are off." :
    alerts.lastAlertAt ? "Last alert " + new Date(alerts.lastAlertAt).toLocaleString() :
    "Use /pause or /resume in your private bot chat.";
}

async function refreshStatus() {
  try {
    const status = await api("?view=status");
    renderModel(status.manualModel, status.manualModelName);
    renderAlerts(status);
  } catch {
    renderModel(false, "Jev", true);
    renderAlerts({ alertError: true });
  }
}

function logActivity(title, detail, at) {
  const row = document.createElement("li");
  const head = document.createElement("div");
  head.className = "activity-head";
  const label = document.createElement("strong");
  label.textContent = title;
  const time = document.createElement("time");
  time.className = "muted";
  time.dateTime = new Date(at).toISOString();
  time.textContent = new Date(at).toLocaleTimeString();
  head.append(label, time);
  const note = document.createElement("p");
  note.className = "activity-detail muted";
  note.textContent = detail;
  row.append(head, note);
  $("history-empty").hidden = true;
  const history = $("history");
  history.prepend(row);
  if (history.children.length > 30) history.lastElementChild.remove();
}

function applyPaperAction(action, quote, now, call) {
  const book = currentBook();
  const next = simulateFill(book, action, quote, now);
  const details = [];
  if (next !== book) {
    books.set(quote.coin, next);
    const fill = `Filled at $${midpoint.format(next.lastFillPrice)} · ${amount.format(next.fees - book.fees)} fee`;
    tradeReceipt = `${quote.coin} ${actionLabels[action].toLowerCase()} · ${fill}`;
    details.push(fill);
  }
  if (call) details.push(`Jev ${call.side.toUpperCase()} · ${Math.round(call.confidence * 100)}% confidence · ${call.latencyMs} ms`);
  logActivity(`${quote.coin} · ${actionLabels[action]}`, details.join(" · "), now);
  renderBook();
}

for (const button of paperButtons) {
  button.addEventListener("click", () => {
    const action = button.dataset.paperAction;
    if (!submitting && hasCurrentQuote() && action !== currentBook().side) {
      applyPaperAction(action, latestQuote, Date.now());
    }
  });
}

$("judge").addEventListener("click", async () => {
  const selected = coin.value;
  submitting = true;
  $("judge").disabled = true;
  coin.disabled = true;
  $("model-status").textContent = `Waiting for ${manualName}…`;
  renderTradeControls();
  try {
    const { call, quote } = await api("", { action: "judge", coin: selected });
    const now = Date.now();
    showQuote(quote);
    if (call.direction) {
      const directions = { up: "Leaning up", down: "Leaning down", unclear: "Unclear direction" };
      logActivity(`${selected} · ${call.name} view`, `${directions[call.direction]} · ${call.reason} · ${call.latencyMs} ms`, now);
      $("model-status").textContent = `${directions[call.direction]}. ${call.reason}`;
      return;
    }
    const book = currentBook();
    const action = call.latencyMs > 5000 ? "hold" : decide(call, book.side, now - book.lastFillAt);
    applyPaperAction(action, quote, now, call);
    $("model-status").textContent = call.latencyMs > 5000 ? "Late answer. Paper position held." :
      action === "hold" ? "Signal checked. The strategy held the paper position." : "Paper trade added to Recent activity.";
  } catch (error) {
    $("model-status").textContent = error.message;
  } finally {
    submitting = false;
    $("judge").disabled = !manualModel;
    coin.disabled = false;
    renderTradeControls();
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
  lastLiveAt = -Infinity;
  latestQuote = undefined;
  tradeReceipt = "";
  clearTimeout(quoteExpiry);
  $("price").textContent = "—";
  $("quote-time").textContent = "Waiting for a market quote";
  feedStatus("Connecting");
  drawChart();
  renderBook();
  $("refresh").disabled = pendingQuotes.has(coin.value);
  refreshQuote();
  refreshHistory();
  connect();
});
$("refresh").addEventListener("click", () => refreshQuote());
$("sync-status").addEventListener("click", refreshStatus);
window.addEventListener("resize", drawChart);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    renderTradeControls();
    refreshStatus();
    if (!hasLiveFeed()) refreshQuote();
  }
});
setInterval(() => {
  if (!document.hidden && !hasLiveFeed()) refreshQuote();
}, SNAPSHOT_INTERVAL_MS);
drawChart();
connect();
refreshQuote();
refreshHistory();
refreshStatus();
