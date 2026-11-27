import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./auth.js";

const frame = (body, script = "") => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Jev Signal Lab</title>
  <link rel="stylesheet" href="/style.css">
  ${script}
</head>
<body>${body}</body>
</html>`;

function setupMessage(issue) {
  const settings = process.env.VERCEL ? "Vercel" : ".env.local";
  const messages = {
    passwordMissing: `The admin password must be set in ${settings} before you can sign in.`,
    passwordLength: `The admin password in ${settings} must be ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters long.`,
    passwordFormat: `The admin password in ${settings} must be on one line and contain a character other than a space.`,
    username: `The admin username in ${settings} can contain letters, numbers, periods, underscores, and hyphens. It must start with a letter or number and be at most 64 characters long.`,
    sessionKey: `The dashboard session signing key in ${settings} needs to be configured.`,
    origin: `The dashboard address in ${settings} must be an HTTPS origin without a trailing slash.`,
  };
  return messages[issue];
}

export const signInPage = ({ setupIssue, error } = {}) => frame(`
  <main class="entry panel">
    <div class="wordmark"><i></i> Jev Signal Lab</div>
    <h1>Sign in</h1>
    ${setupIssue ? `<p>${setupMessage(setupIssue)}</p>` : `
    ${error ? `<p class="sign-in-error" role="alert">${error}</p>` : ""}
    <form action="/" method="post" class="sign-in">
      <input type="hidden" name="action" value="login">
      <label>Username
        <input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="64" required>
      </label>
      <label>Password
        <input name="password" type="password" autocomplete="current-password" maxlength="${MAX_PASSWORD_LENGTH}" required>
      </label>
      <button type="submit">Sign in</button>
    </form>`}
  </main>`);

export const dashboard = () => frame(`
  <header class="top">
    <div class="wordmark"><i></i> Jev Signal Lab</div>
    <form action="/" method="post"><button type="submit" name="action" value="logout" class="quiet">Sign out</button></form>
  </header>
  <main class="workspace" data-server-time="${Date.now()}">
    <div class="page-title">
      <div><p class="eyebrow">HYPERLIQUID MARKETS</p><h1>Paper trading</h1></div>
      <div class="market-select"><label for="coin">Market</label><select id="coin"><option>BTC</option><option>ETH</option><option>HYPE</option></select></div>
    </div>
    <div class="layout">
      <section class="panel market" aria-labelledby="market-heading">
        <div class="section-head"><h2 id="market-heading">Market price</h2><span id="feed-status" class="pill neutral">Connecting</span></div>
        <p id="price" class="price">—</p>
        <div class="quote-meta">
          <p id="quote-time" class="muted">Waiting for a market quote</p>
          <button type="button" id="refresh" class="quiet">Refresh quote</button>
        </div>
        <canvas id="chart" role="img" aria-label="Recent midpoint prices"></canvas>
        <section class="practice" aria-labelledby="practice-heading">
          <h2 id="practice-heading">Practice a trade</h2>
          <p class="muted">Paper buy opens a long position. Paper sell opens a short position. Both use simulated funds.</p>
          <div class="paper-actions">
            <button type="button" data-paper-action="buy" disabled>Paper buy</button>
            <button type="button" data-paper-action="sell" class="paper-sell" disabled>Paper sell</button>
            <button type="button" data-paper-action="flat" class="quiet" disabled>Close position</button>
          </div>
          <p id="trade-status" class="muted" role="status">Waiting for a current quote.</p>
        </section>
      </section>
      <aside class="sidebar">
        <section class="panel" aria-labelledby="account-heading">
          <div class="section-head"><h2 id="account-heading">Paper account</h2><span id="account-market" class="muted">BTC</span></div>
          <dl>
            <div><dt>Balance</dt><dd id="balance">$1,000.00</dd></div>
            <div><dt>Position</dt><dd id="position">Flat</dd></div>
            <div><dt>Before fees</dt><dd id="gross">$0.00</dd></div>
            <div><dt>Fees</dt><dd id="fees">$0.00</dd></div>
            <div class="total"><dt>Net P&amp;L</dt><dd id="net">$0.00</dd></div>
          </dl>
          <p class="muted">$1,000 per market. The spread and a 0.045% fee per fill affect your net P&amp;L.</p>
        </section>
        <section class="panel connections" aria-labelledby="connections-heading">
          <h2 id="connections-heading">Signals and alerts</h2>
          <div class="connection">
            <div class="section-head"><h3 id="model-heading">AI signals</h3><span id="model-pill" class="pill neutral">Checking</span></div>
            <p id="model-status" class="muted" role="status"></p>
            <button type="button" id="judge" hidden disabled>Ask Jev</button>
          </div>
          <div class="connection">
            <div class="section-head"><h3>Telegram alerts</h3><span id="alert-pill" class="pill neutral" role="status">Checking</span></div>
            <p id="alert-note" class="muted"></p>
            <div class="connection-actions">
              <button type="button" id="toggle" hidden disabled>Resume alerts</button>
              <button type="button" id="sync-status" class="quiet" hidden>Sync status</button>
            </div>
          </div>
        </section>
      </aside>
    </div>
    <section class="panel history" aria-labelledby="decisions-heading">
      <div class="section-head"><h2 id="decisions-heading">Recent activity</h2><span class="muted">This page only</span></div>
      <p id="history-empty" class="muted">Your paper trades and signals will appear here.</p>
      <ul id="history" class="activity-list" role="list" aria-label="Paper trades and signals"></ul>
    </section>
  </main>`, '<script type="module" src="/dashboard.js"></script>');
