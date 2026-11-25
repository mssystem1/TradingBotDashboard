import { MIN_CONFIDENCE } from "../public/strategy.js";

export const SLOT_MS = 15 * 60_000;

export async function checkAlerts({ store, marketState, signal, send, coin, limit, clock = Date.now }) {
  const now = clock();
  const slotDuration = Math.max(SLOT_MS, Math.ceil(86_400_000 / limit));
  const slot = Math.floor(now / slotDuration) * slotDuration;
  const day = new Date(now).toISOString().slice(0, 10);
  const reserved = await store.update(state => {
    const count = state.callDate === day ? state.callsToday : 0;
    if (state.paused || (state.lastSlot !== null && state.lastSlot >= slot) || count >= limit) return state;
    return { ...state, lastSlot: slot, callDate: day, callsToday: count + 1 };
  });
  if (!reserved.changed) return reserved.value.paused ? "paused" : "already checked or daily limit reached";

  const { quote, metrics } = await marketState(coin);
  const current = await store.current();
  if (current.paused || current.changedAt !== reserved.value.changedAt) return "pause changed";
  const call = await signal(metrics, "scheduled");
  if (call.confidence < MIN_CONFIDENCE) return "held";

  const beforeSend = await store.current();
  if (beforeSend.paused || beforeSend.changedAt !== reserved.value.changedAt || beforeSend.lastSlot !== slot) {
    return "pause changed";
  }
  if (beforeSend.lastSide === call.side) return "unchanged signal";
  const direction = call.side.toUpperCase();
  const price = quote.price.toLocaleString("en-US", { maximumFractionDigits: 6 });
  await send("Paper signal · " + coin + " " + direction + "\nJev confidence: " +
    Math.round(call.confidence * 100) + "% · " + call.latencyMs + " ms\nMarket midpoint: $" + price +
    "\nNo order was placed. /pause to pause alerts.");
  await store.update(state => ({ ...state, lastSide: call.side, lastAlertAt: clock() }));
  return "sent";
}
