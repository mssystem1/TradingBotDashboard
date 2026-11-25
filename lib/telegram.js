export async function telegram(method, payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!/^\d+:[A-Za-z0-9_-]{25,}$/.test(token || "")) throw new Error("Telegram bot token is not configured");
  try {
    const response = await fetch("https://api.telegram.org/bot" + token + "/" + method, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
    if (response.ok) {
      const data = await response.json();
      if (data.ok) return data.result;
    }
  } catch {
    // Never expose a URL that contains a Telegram bot token.
  }
  throw new Error("Telegram request failed");
}

export function allowedChat() {
  const id = process.env.TELEGRAM_CHAT_ID;
  return /^\d{1,16}$/.test(id || "") ? id : null;
}

export async function send(text) {
  const id = allowedChat();
  if (!id) throw new Error("Private Telegram chat is not configured");
  return telegram("sendMessage", { chat_id: id, text });
}
