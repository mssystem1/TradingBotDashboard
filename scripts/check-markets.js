import { appendFile } from "node:fs/promises";
import { quote } from "../lib/market.js";

const markets = ["BTC", "ETH", "HYPE"];
const prices = await Promise.all(markets.map(quote));
const format = new Intl.NumberFormat("en-US", { maximumFractionDigits: 5 });
const results = [
  "### Hyperliquid public price check",
  "",
  "| Market | Bid | Ask | Midpoint | Quote time (UTC) |",
  "| --- | ---: | ---: | ---: | --- |",
  ...prices.map(({ coin, bid, ask, price, time }) =>
    `| ${coin} | ${format.format(bid)} | ${format.format(ask)} | ${format.format(price)} | ${new Date(time).toISOString()} |`),
  "",
].join("\n");
console.log(results);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, results);
