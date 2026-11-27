const CACHE_MS = 120_000;
let cached;

export async function workerStatus() {
  const repo = process.env.PAPER_WORKER_REPO?.trim() ||
    `${process.env.VERCEL_GIT_REPO_OWNER || ""}/${process.env.VERCEL_GIT_REPO_SLUG || ""}`;
  if (!/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) return { state: "unconfigured" };
  if (cached?.repo === repo && Date.now() - cached.fetchedAt < CACHE_MS) return cached.value;

  const url = `https://api.github.com/repos/${repo}/actions/workflows/alerts.yml/runs?branch=main&per_page=1`;
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "TradingBotDashboard" },
    signal: AbortSignal.timeout(4500),
    redirect: "error",
  });
  if (!response.ok) throw new Error("Background worker status is unavailable");
  const { workflow_runs: runs } = await response.json();
  const run = runs?.[0];
  if (!run) return { state: "waiting" };
  const at = Date.parse(run.updated_at || "");
  if (!Number.isSafeInteger(run.id) || !Number.isFinite(at)) throw new Error("Invalid background check metadata");
  const state = run.status !== "completed" ? "running" : run.conclusion === "success" ? "passed" : "failed";
  const value = { state, at, url: `https://github.com/${repo}/actions/runs/${run.id}` };
  cached = { repo, fetchedAt: Date.now(), value };
  return value;
}
