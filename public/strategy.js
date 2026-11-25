export const MIN_CONFIDENCE = 0.85;
export const MIN_HOLD_MS = 15_000;

export function decide(call, position, elapsedMs) {
  if (call.confidence < MIN_CONFIDENCE) return "hold";
  if (position === call.side || elapsedMs < MIN_HOLD_MS) return "hold";
  return call.side;
}

export function positionSize(target, price, notional = 1000) {
  return ({ buy: 1, sell: -1, flat: 0 })[target] * notional / price;
}

export function simulateFill(book, action, quote, now) {
  if (action === "hold") return book;
  const buying = action === "buy" || (action === "flat" && book.quantity < 0);
  const price = buying ? quote.ask : quote.bid;
  const target = positionSize(action, price);
  const quantity = target - book.quantity;
  return {
    cash: book.cash - quantity * price,
    quantity: target,
    fees: book.fees + Math.abs(quantity) * price * 0.00045,
    fills: book.fills + 1,
    lastFillAt: now,
    side: action,
  };
}
