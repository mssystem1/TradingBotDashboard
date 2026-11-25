import { existsSync } from "node:fs";
import { allowedChat, telegram } from "../lib/telegram.js";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
try {
  const origin = new URL(process.env.APP_ORIGIN);
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const chatId = allowedChat();
  if (origin.protocol !== "https:" || origin.href !== origin.origin + "/" || !chatId ||
      !/^[A-Za-z0-9_-]{32,256}$/.test(secret || "")) throw new Error("Configure the app URL, private chat, and webhook secret first.");
  const url = origin.origin + "/api/telegram";
  const old = await telegram("getWebhookInfo", {});
  if (old.url && old.url !== url) throw new Error("This bot already has a different webhook. Use a dedicated bot for Jev.");
  const chat = await telegram("getChat", { chat_id: chatId });
  if (String(chat.id) !== chatId || chat.type !== "private") throw new Error("Start a private chat with the bot first.");
  await telegram("setWebhook", { url, secret_token: secret, allowed_updates: ["message"], max_connections: 1 });
  const config = await telegram("getWebhookInfo", {});
  if (config.url !== url) throw new Error("Telegram did not confirm the webhook.");
  console.log("Private Telegram webhook connected. Use /status in your bot chat.");
} catch (error) {
  console.error(error instanceof TypeError ? "Check the app URL and private Telegram configuration." : error.message);
  process.exitCode = 1;
}
