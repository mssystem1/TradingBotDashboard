import assert from "node:assert/strict";

let stored;
let version = 0;
export class BlobPreconditionFailedError extends Error {}

function check(path, options) {
  assert.equal(path, "jev-signal-lab/alert-state.json");
  assert.equal(options.access, "private");
  assert.equal(options.token, "vercel_blob_rw_fixture_testonly");
  if (process.env.FIXTURE_BLOB_UNAVAILABLE === "true") throw new Error("Fixture alert storage unavailable");
}

export async function get(path, options) {
  check(path, options);
  assert.equal(options.useCache, false);
  return stored ? { statusCode: 200, stream: new Response(stored).body, blob: { etag: "fixture-" + version } } : null;
}

export async function put(path, data, options) {
  check(path, options);
  if (stored && options.ifMatch !== "fixture-" + version) throw new BlobPreconditionFailedError();
  assert.equal(options.allowOverwrite, Boolean(stored));
  assert.equal(options.addRandomSuffix, false);
  stored = data;
  version++;
}
