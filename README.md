# TradingBotDashboard

TradingBotDashboard, shown in the browser as **Jev Signal Lab**, is a private dashboard for experimenting with crypto paper trading. It streams public Hyperliquid prices for BTC, ETH, and HYPE. With AI Gateway enabled, you can ask Jev for a directional call and see whether the strategy would act. The dashboard simulates each fill and shows the spread, fees, and resulting profit or loss. It has no exchange order endpoint and requires no exchange account.

## What you can do

| Feature | What it shows or does |
| --- | --- |
| Live market view | The midpoint between the best bid and ask, a chart seeded from completed one-minute candles, and the quote time. The quote loads independently of the chart and uses the server clock to check freshness. If streaming is unavailable, the dashboard refreshes its snapshot every 15 seconds while the browser tab is visible. |
| Practice a trade | **Paper buy**, **Paper sell**, and **Close position** use the current bid or ask. Each fill shows its price and fee and appears in Recent activity. |
| Ask Jev | Requests one BUY or SELL forecast for the next 15 minutes using recent market data. The decision history shows the direction, model confidence, response time, and paper action. |
| Paper account | Starts at $1,000. The dashboard shows the current position, balance, gross P&L, fees, and net P&L. |
| Telegram controls | Pause or resume scheduled paper alerts from the dashboard or a single authorized Telegram chat. Both controls use the same saved setting. |

The dashboard starts with market prices and paper trading controls. Model calls are off until you enable them. Each market has its own simulated $1,000 account within the open page. Reloading the page resets positions and recent activity.

## Try a paper trade

1. Choose BTC, ETH, or HYPE and wait for the price. **15s updates** means the dashboard is polling for quotes.
2. Tap **Paper buy** to open a long position or **Paper sell** to open a short position. Check the fill price and fee below the buttons, then look at the paper account and Recent activity.
3. Tap **Close position** to exit. If the quote expires, wait for the next update or tap **Refresh quote**. Paper trades use public quotes and simulated funds.

## Run locally

You need [Node.js 24](https://nodejs.org/) with npm and Git.

```sh
git clone https://github.com/mssystem1/TradingBotDashboard.git
cd TradingBotDashboard
npm ci
cp .env.example .env.local
```

1. Open `.env.local` and set `DASHBOARD_ADMIN_PASSWORD` to a unique password of 9 to 128 characters. Set `DASHBOARD_SESSION_KEY` to a separate, random value of at least 32 URL-safe characters. The local username defaults to `admin`. Leave both model flags off for the first run.
2. Run `npm run dev` and open [the local dashboard](http://127.0.0.1:8767/). Sign in with the username and password from your local settings.
3. Choose a market and check that the price is updating. Use **Refresh quote** to check the latest snapshot. Press Ctrl+C in the terminal to stop the app.

## Run the tests

`npm test` checks access control, paper-fill accounting, alert scheduling, and the exact command the alert workflow runs. The workflow test needs Bash. On Windows, use Git Bash or WSL.

```sh
npx playwright install chromium webkit
npm run test:e2e
JEV_TEST_BROWSER=webkit npm run test:e2e
```

Playwright exercises sign-in and sign-out, the live-price interface, market switching, manual trading from snapshots, stale quotes, Jev-driven simulated fills, and pause and resume in both the dashboard and the Telegram webhook. It checks desktop, tablet, and phone layouts along with automated accessibility rules in Chromium and WebKit, the browser engine Safari uses. The tests use simulated provider responses. They require no real keys, model credits, or Telegram account. The **Dashboard tests** GitHub workflow runs these checks.

## How the paper strategy works

[The strategy](public/strategy.js) requires at least 85% Jev confidence and waits at least 15 seconds after a simulated fill before changing direction. A call on the same side as the current position produces a hold. The dashboard also holds on a response that takes more than five seconds.

The simulator targets $1,000 of exposure. It buys at the ask, sells at the bid, and charges an assumed 4.5 basis points per fill on the amount traded. A reversal can transact more than $1,000 because it closes the old position and opens the new one. Gross P&L includes the effect of the execution price. Net P&L also subtracts the accumulated fees.

To change the confidence threshold or the waiting period, edit `MIN_CONFIDENCE` or `MIN_HOLD_MS` in `public/strategy.js` and rerun the tests. The scheduled alert runner shares the confidence threshold and uses its own schedule. Before relying on a strategy, explain why its inputs might predict the move, test it after spread, fees, and slippage, and evaluate it on a later period you did not use to tune it.

## Deploy the dashboard to Vercel

1. Import this repository into a Vercel project. The included [Vercel configuration](vercel.json) serves the frontend and routes dashboard requests to a Node.js function.
2. In Vercel under **Environment Variables**, set `APP_ORIGIN` to the exact HTTPS address you will open in the browser, with no trailing slash. In the **Production** environment, add `DASHBOARD_ADMIN_PASSWORD` and a separate `DASHBOARD_SESSION_KEY` as **Secret** variables. Set `DASHBOARD_ADMIN_USERNAME` if you want a username other than `admin`.
3. Deploy or redeploy, then open the configured HTTPS address. Sign in with the same username and password from each browser or device. **Sign out** clears that browser's session. To change the password, update `DASHBOARD_ADMIN_PASSWORD` in Vercel and redeploy to Production. Existing sessions expire as soon as the new production deployment takes over. The app stays locked until its sign-in settings are complete.
4. To enable **Ask Jev**, add `AI_GATEWAY_API_KEY`, set `ENABLE_MANUAL_MODEL=true`, and redeploy after reviewing your AI Gateway budget. Manual calls and scheduled alerts have separate switches.

The single admin login uses Vercel environment variables and needs no account database. The app requires a signed 12-hour session cookie for dashboard data, limits failed sign-in attempts per server instance, and checks the request origin before accepting browser changes. Keep credentials in local environment files or the relevant service's secret settings. If you enable scheduled alerts or Telegram, their HTTPS endpoints must be reachable by those services. Each endpoint checks its own secret.

## Set up Telegram paper alerts

1. Link a **private Vercel Blob** store to the project. It stores the shared pause setting and alert history used to prevent duplicate sends.
2. Use a dedicated Telegram bot and send it `/start` in a private chat. Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and `TELEGRAM_WEBHOOK_SECRET` in Vercel. The chat ID is the numeric ID of the single authorized private chat. The webhook secret must be at least 32 characters and use only letters, numbers, underscores, or hyphens.
3. Once the production app is deployed with those settings, set the same Telegram values and production `APP_ORIGIN` in your private local `.env.local`. Run `node scripts/link-telegram.js`. The script checks the private chat and verifies the webhook. It refuses to replace a webhook pointing to a different app.
4. Generate a separate random `ALERT_JOB_SECRET` of at least 32 characters. Set it both in Vercel and as a repository secret under **Settings → Secrets and variables → Actions**. In the same area, add the repository variable `ALERT_APP_ORIGIN` with the production HTTPS origin, without a trailing slash.
5. When the model budget is approved, set `AI_GATEWAY_API_KEY` and `ENABLE_SCHEDULED_MODEL=true` in Vercel and redeploy. Set the GitHub repository variable `ALERT_JOB_ENABLED=true`. In **Actions → Paper alerts**, run the workflow manually to check the connection. The stored alert state starts paused, so this first check can return `paused` without using a model request.

| Action | Dashboard | Telegram |
| --- | --- | --- |
| Pause future notifications | **Pause alerts** | `/pause` |
| Resume checking for notifications | **Resume alerts** | `/resume` |
| Read the shared state | **Sync status** | `/status` |

The workflow is configured to check four times an hour. With the default limit of 24 model calls per UTC day, the app can ask Jev roughly once an hour. It reserves at most one request per time slot and only sends a message when the call meets the confidence threshold and changes direction from the last alert. GitHub can delay or skip scheduled runs. Pausing suppresses future alert checks and messages. Setting `ALERT_JOB_ENABLED=false` disables the workflow job altogether.

## Configuration reference

| Setting | Where it goes | Purpose |
| --- | --- | --- |
| `DASHBOARD_ADMIN_USERNAME` | Local / Vercel | The single admin username, default `admin`. Up to 64 letters, numbers, periods, underscores, or hyphens, starting with a letter or number. |
| `DASHBOARD_ADMIN_PASSWORD` | Local / Vercel Secret | The admin's unique password, 9 to 128 characters. |
| `DASHBOARD_SESSION_KEY` | Local / Vercel Secret | Random signing key separate from the password, 32 to 128 letters, numbers, underscores, or hyphens. |
| `APP_ORIGIN` | Vercel / local webhook setup | Exact production HTTPS origin. For local dashboard use, it can be left blank. |
| `AI_GATEWAY_API_KEY` | Local / Vercel | Needed for Jev requests. Use a Gateway key with a spend limit appropriate for testing. |
| `ENABLE_MANUAL_MODEL` | Local / Vercel | Enables **Ask Jev**. Defaults to `false`. |
| `ENABLE_SCHEDULED_MODEL` | Vercel | Enables model requests from the alert job. Defaults to `false`. |
| `BLOB_READ_WRITE_TOKEN` | Vercel | Private storage access for the shared alert state. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET` | Vercel / local webhook setup | Dedicated bot credentials, authorized private chat, and webhook authentication. |
| `ALERT_JOB_SECRET` | Vercel / GitHub Actions secret | Authenticates scheduled checks. Use the same value in both services. |
| `ALERT_APP_ORIGIN`, `ALERT_JOB_ENABLED` | GitHub Actions variables | Select the production app and enable the workflow job. |
| `ALERT_COIN` | Vercel | Market for scheduled alerts. Default `BTC`. Also supports `ETH` and `HYPE`. |
| `ALERT_MAX_CALLS_PER_DAY` | Vercel | Maximum scheduled model requests per UTC day, from 1 to 96. Defaults to 24. The provider's billing limit is separate. |

## Project layout

| Path | Responsibility |
| --- | --- |
| `api/dashboard.js`, `lib/auth.js` | Admin sign-in, market data for signed-in sessions, manual Jev calls, and dashboard alert controls. |
| `api/telegram.js` | Authenticated Telegram webhook and private-chat commands. |
| `api/alerts.js`, `lib/alerts.js` | Scheduled alert checks, daily request limits, and notification logic. |
| `lib/state.js` | Shared alert state in private Blob storage, with conditional writes to prevent lost updates. |
| `public/` | Dashboard interface, real-time price chart, and browser-side paper simulator. |
| `.github/workflows/alerts.yml` | GitHub Actions schedule and manual dispatch. |
| `scripts/`, `test/` | Local server, Telegram webhook setup, and automated tests. |

## Companion Python starter

The separate Python starter contains the continuous paper loop, headline newsroom, and optional Linux-based Bybit Demo worker. Those tools are outside this web repository. The newsroom replays published headlines against the market moves that followed. The demo worker uses Jev for fast calls and Grok for higher-level market direction. In that worker's `.env`, `BIAS_MODEL=openai/gpt-4.1-mini` switches the bias model to OpenAI. Telegram pause and resume control web alerts only. The demo worker has its own system service, position and daily-loss limits, and STOP file.
