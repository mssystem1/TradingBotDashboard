# Jev Signal Lab

A private web dashboard for paper trading with public Hyperliquid prices and optional Jev calls. The web app simulates fills, spread and fees. It has no exchange credentials, broker connection, or order endpoint.

## Local web app

Run `npm ci`, then copy `.env.example` to `.env.local`. Generate a unique random dashboard passphrase of at least 32 characters, set `DASHBOARD_PASSWORD` in the local file, and run `npm run dev`. The app listens on localhost at port 8767. `npm test` runs the checks with fake credentials and provider responses.

The companion Python starter runs the streaming paper loop and the newsroom replay locally. It also has a separate Bybit Demo worker. The demo worker and localhost dashboards stay off the Vercel deployment.

## Private Vercel dashboard

Link the GitHub repository to a Vercel project. Set `DASHBOARD_PASSWORD` and the exact HTTPS `APP_ORIGIN` for the deployment in Vercel's environment settings, then deploy. The sign-in screen is the only dashboard page shown to visitors without a session. Keep the production URL accessible to the authenticated Telegram and scheduled job endpoints described below.

Live prices work with model calls off. Enable `ENABLE_MANUAL_MODEL` only once you have approved model usage and set `AI_GATEWAY_API_KEY` with a spend limit appropriate to you. The paper position and decision history belong to the current browser session.

## Telegram alerts

1. Link a private Vercel Blob store to the project. Set `TELEGRAM_BOT_TOKEN`, the authorized private `TELEGRAM_CHAT_ID`, and a random `TELEGRAM_WEBHOOK_SECRET` of at least 32 characters. Use a dedicated Telegram bot and send it `/start`.
2. Run `node scripts/link-telegram.js` with the same local configuration to register the webhook. It verifies the destination and refuses to replace an existing webhook belonging to a different app.
3. Set the same random `ALERT_JOB_SECRET` in Vercel and as a GitHub Actions secret. Set the GitHub repository variable `ALERT_APP_ORIGIN` to the deployment origin without a trailing slash.
4. After you approve the request budget, set `ENABLE_SCHEDULED_MODEL=true` in Vercel, redeploy, and set the GitHub repository variable `ALERT_JOB_ENABLED=true`. Dispatch the workflow once to verify setup.

Alerts start paused. Use **Resume alerts** on the dashboard or `/resume` in the authorized private chat. Use **Pause alerts** or `/pause` to pause. `/status` reports the same stored setting. You can also set `ALERT_JOB_ENABLED=false` to stop scheduled checks altogether.

The schedule runs around the clock on GitHub's standard runners. GitHub can delay or skip a scheduled run. The app reserves at most one model request per time slot in private storage. The default cap allows up to 24 requests per UTC day, spaced roughly hourly, and only changed calls with at least 85% confidence trigger a message. Set a provider budget separately. These alerts are informational and independent of any Bybit Demo orders.
