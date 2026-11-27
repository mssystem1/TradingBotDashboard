import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";

const workflow = parse(await readFile(new URL("../.github/workflows/alerts.yml", import.meta.url), "utf8"));
const check = workflow.jobs.check;
const source = check.steps[0].run;
const testOrigin = "https://alerts.example";
const jobKey = "fixture-only-" + "a".repeat(32);

test("the alert workflow stays off until enabled and runs serially", () => {
  assert.deepEqual(workflow.on.schedule, [{ cron: "7,22,37,52 * * * *" }]);
  assert.ok(Object.hasOwn(workflow.on, "workflow_dispatch"));
  assert.deepEqual(workflow.permissions, {});
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  assert.equal(check.if, "vars.ALERT_JOB_ENABLED == 'true'");
  assert.equal(check.env.JOB_KEY, "${{ secrets.ALERT_JOB_SECRET }}");
});

test("the hosted worker runs public price checks on the standard public runner without secrets", async t => {
  const job = workflow.jobs.prices;
  assert.equal(job["runs-on"], "ubuntu-latest");
  assert.deepEqual(job.permissions, { contents: "read" });
  assert.equal(job.if, "github.event.repository.private == false");
  assert.doesNotMatch(JSON.stringify(job), /secrets\./);
  assert.equal(job.steps.at(-1).run, "node scripts/check-markets.js");
  assert.ok(workflow.on.push.paths.includes("scripts/check-markets.js"));
  const dir = await mkdtemp(join(tmpdir(), "jev-price-summary-"));
  t.after(() => rm(dir, { force: true, recursive: true }));
  const summary = join(dir, "summary.md");
  const result = spawnSync(process.execPath, ["--import", "./test/fixtures/providers.js", "scripts/check-markets.js"], {
    encoding: "utf8", env: { GITHUB_STEP_SUMMARY: summary },
  });
  assert.equal(result.status, 0, result.stderr);
  const report = await readFile(summary, "utf8");
  assert.match(report, /Hyperliquid public price check/);
  assert.match(report, /\| BTC \| 99 \| 101 \| 100 \|/);
  assert.match(report, /\| ETH \| 39 \| 41 \| 40 \|/);
  assert.match(report, /\| HYPE \| 9 \| 11 \| 10 \|/);
});

test("the runner validates its settings, uses HTTPS, and surfaces failed checks", async t => {
  const dir = await mkdtemp(join(tmpdir(), "jev-workflow-"));
  t.after(() => rm(dir, { force: true, recursive: true }));
  await writeFile(join(dir, "curl"), `#!/usr/bin/env bash
[[ "$#" -eq 12 && "$1" == --proto && "$2" == =https && "$3" == --max-time &&
   "$4" == 35 && "$5" == --fail && "$6" == --silent && "$7" == --show-error &&
   "$8" == --request && "$9" == POST ]] || exit 90
shift 9
[[ "$1" == --header && "$2" == "Authorization: Bearer $JOB_KEY" &&
   "$3" == "$APP_ORIGIN/api/alerts" ]] || exit 91
printf '%s' 'fixture request checked'
exit "$FIXTURE_EXIT"
`, { mode: 0o700 });
  const run = (origin, token, exitCode = "0") => spawnSync("bash", ["-eo", "pipefail", "-c", source], {
    encoding: "utf8",
    env: { PATH: dir + delimiter + process.env.PATH, APP_ORIGIN: origin, JOB_KEY: token,
      FIXTURE_EXIT: exitCode },
  });
  for (const result of [run("http://alerts.example", jobKey), run(testOrigin + "/path", jobKey), run(testOrigin, "short")]) {
    assert.equal(result.status, 1);
    assert.match(result.stdout, /Set the Vercel HTTPS origin/);
  }
  const success = run(testOrigin, jobKey);
  assert.equal(success.status, 0);
  assert.equal(success.stdout, "fixture request checked");
  assert.doesNotMatch(success.stdout + success.stderr, /fixture-only-/);
  assert.equal(run(testOrigin, jobKey, "22").status, 22);
});
