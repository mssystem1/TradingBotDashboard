import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import dashboard from "../api/dashboard.js";
import alerts from "../api/alerts.js";
import telegram from "../api/telegram.js";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const port = Number(process.env.PORT || 8767);
const routes = new Map([
  ["/", dashboard],
  ["/api/dashboard", dashboard],
  ["/api/alerts", alerts],
  ["/api/telegram", telegram],
]);
const contentTypes = new Map([
  ["/style.css", "text/css"],
  ["/access.js", "text/javascript"],
  ["/dashboard.js", "text/javascript"],
  ["/strategy.js", "text/javascript"],
]);

const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://127.0.0.1").pathname;
    if (routes.has(path)) return await routes.get(path)(req, res);
    if (req.method === "GET" && contentTypes.has(path)) {
      const content = await readFile(new URL("../public" + path, import.meta.url));
      res.setHeader("Content-Type", contentTypes.get(path));
      return res.end(content);
    }
    res.writeHead(404);
    res.end("Not found");
  } catch {
    res.writeHead(500);
    res.end("Request failed");
  }
});
server.listen(port, "127.0.0.1", () => console.log("Private local web app at http://127.0.0.1:" + server.address().port));
