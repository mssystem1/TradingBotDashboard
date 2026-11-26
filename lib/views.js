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

export const signInPage = ({ configured = true, error } = {}) => frame(`
  <main class="entry panel">
    <div class="wordmark"><i></i> Jev Signal Lab</div>
    <h1>Sign in</h1>
    ${configured ? `
    ${error ? `<p class="sign-in-error" role="alert">${error}</p>` : ""}
    <form action="/" method="post" class="sign-in">
      <input type="hidden" name="action" value="login">
      <label>Username
        <input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="64" required>
      </label>
      <label>Password
        <input name="password" type="password" autocomplete="current-password" maxlength="128" required>
      </label>
      <button type="submit">Sign in</button>
    </form>` : `<p>The admin password must be set in ${process.env.VERCEL ? "Vercel" : ".env.local"} before you can sign in.</p>`}
  </main>`);

export const dashboard = frame(`
  <header class="top">
    <div class="wordmark"><i></i> Jev Signal Lab</div>
    <form action="/" method="post"><button type="submit" name="action" value="logout" class="quiet">Sign out</button></form>
  </header>
  <main class="workspace">
    <div class="page-title">
      <div><p class="eyebrow">HYPERLIQUID MARKETS</p><h1>Paper trading</h1></div>
      <label class="market-select">Market <select id="coin"><option>BTC</option><option>ETH</option><option>HYPE</option></select></label>
    </div>
    <div class="layout">
      <section class="panel market" aria-labelledby="market-heading">
        <div class="section-head"><h2 id="market-heading">Live midpoint</h2><span id="feed-status" class="pill">Connecting</span></div>
        <p id="price" class="price">—</p>
        <p id="quote-time" class="muted">Waiting for a market quote</p>
        <canvas id="chart" role="img" aria-label="Recent midpoint prices"></canvas>
        <div class="actions">
          <button id="judge" disabled>Ask Jev</button>
          <button id="refresh" class="quiet">Refresh quote</button>
          <p id="model-status" role="status"></p>
        </div>
      </section>
      <aside class="sidebar">
        <section class="panel" aria-labelledby="account-heading">
          <h2 id="account-heading">Paper account</h2>
          <dl>
            <div><dt>Balance</dt><dd id="balance">$1,000.00</dd></div>
            <div><dt>Position</dt><dd id="position">Flat</dd></div>
            <div><dt>Before fees</dt><dd id="gross">$0.00</dd></div>
            <div><dt>Fees</dt><dd id="fees">$0.00</dd></div>
            <div class="total"><dt>Net P&amp;L</dt><dd id="net">$0.00</dd></div>
          </dl>
          <p class="muted">$1,000 target position. Simulated market fills use the bid or ask and a 4.5 bps fee.</p>
        </section>
        <section class="panel" aria-labelledby="alerts-heading">
          <div class="section-head"><h2 id="alerts-heading">Telegram alerts</h2><span id="alert-pill" class="pill" role="status">Loading</span></div>
          <p id="alert-note" class="muted">Checking the alert setting.</p>
          <button type="button" id="toggle" disabled>Resume alerts</button>
          <button type="button" id="sync-status" class="quiet">Sync status</button>
        </section>
      </aside>
    </div>
    <section class="panel history" aria-labelledby="decisions-heading">
      <div class="section-head"><h2 id="decisions-heading">Decision history</h2><span class="muted">This browser session</span></div>
      <div class="table-wrap" tabindex="0" role="region" aria-label="Decision history table">
        <table><thead><tr><th scope="col">Time</th><th scope="col">Market</th><th scope="col">Jev call</th><th scope="col">Confidence</th><th scope="col">Latency</th><th scope="col">Paper action</th></tr></thead>
        <tbody id="history"><tr><td colspan="6">Your first call will appear here.</td></tr></tbody></table>
      </div>
    </section>
  </main>`, '<script type="module" src="/dashboard.js"></script>');
