// This preloader runs only for the browser suite. Unexpected provider calls fail
// instead of reaching a real account.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

let manualCalls = 0;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@vercel/blob") {
      return { url: new URL("./blob.js", import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

globalThis.fetch = async (input, options) => {
  const url = new URL(input);
  const body = JSON.parse(options?.body || "{}");
  if (url.hostname === "api.hyperliquid.xyz" && body.type === "l2Book") {
    const midpoint = { BTC: 100, ETH: 40, HYPE: 10 }[body.coin];
    assert.ok(midpoint);
    return Response.json({
      levels: [[{ px: String(midpoint - 1), sz: "2" }], [{ px: String(midpoint + 1), sz: "1" }]],
      time: Date.now(),
    });
  }
  if (url.hostname === "api.hyperliquid.xyz" && body.type === "candleSnapshot") {
    return Response.json(Array.from({ length: 16 }, (_, i) => ({ t: body.req.startTime + i * 60_000, c: 100 + i })));
  }
  if (url.hostname === "ai-gateway.vercel.sh" && url.pathname === "/typesafe/v1/systemone") {
    assert.equal(body.model, "typesafe-ai/jev");
    assert.equal(typeof JSON.parse(body.state).return_15m_bps, "number");
    manualCalls++;
    const side = manualCalls === 1 ? "buy" : "sell";
    const confidence = manualCalls === 3 ? 0.6 : 0.92;
    return Response.json({ answers: { side: { choice: side, probabilities: { [side]: confidence } } } });
  }
  if (url.hostname === "ai-gateway.vercel.sh" && url.pathname === "/v1/chat/completions") {
    assert.ok(["spacexai/grok-4.20-non-reasoning", "openai/gpt-4.1-mini"].includes(body.model));
    assert.equal(JSON.parse(body.messages[1].content).market, "BTC");
    assert.equal(body.max_tokens, 160);
    if (process.env.FIXTURE_GATEWAY_DENIED === "true") {
      return Response.json({ error: { type: "no_providers_available" } }, { status: 403 });
    }
    return Response.json({ choices: [{ message: { content: JSON.stringify({
      direction: "unclear", reason: "The recent market moves are mixed.",
    }) } }] });
  }
  if (url.hostname === "api.telegram.org" && url.pathname.endsWith("/sendMessage")) {
    assert.equal(String(body.chat_id), "123456789");
    if (body.text.startsWith("Paper signal")) assert.match(body.text, /No order was placed/);
    process.stdout.write("Fixture Telegram notification\n");
    return Response.json({ ok: true, result: { message_id: 1 } });
  }
  throw new Error("Unexpected external request in the browser fixture");
};
