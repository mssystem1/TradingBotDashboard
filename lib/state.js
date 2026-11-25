import { BlobPreconditionFailedError, get, put } from "@vercel/blob";

const PATH = "jev-signal-lab/alert-state.json";
const empty = {
  paused: true,
  changedAt: null,
  lastSlot: null,
  callDate: null,
  callsToday: 0,
  lastSide: null,
  lastAlertAt: null,
  telegramLastUpdate: null,
  telegramLastDate: null,
};

export function createStore({ read, write }) {
  return {
    async current() {
      return (await read()).value;
    },
    async update(change) {
      for (let tries = 0; tries < 5; tries++) {
        const { value, version } = await read();
        const next = change(value);
        if (next === value) return { changed: false, value };
        if (await write(next, version)) return { changed: true, value: next };
      }
      throw new Error("Alert state changed concurrently");
    },
  };
}

export function alertStore() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("Private alert storage is not configured");
  const readBlob = () => get(PATH, { access: "private", useCache: false, abortSignal: AbortSignal.timeout(4000) });
  return createStore({
    async read() {
      const result = await readBlob();
      if (!result) return { value: { ...empty }, version: null };
      if (result.statusCode !== 200) throw new Error("Alert state is unavailable");
      const stored = await new Response(result.stream).json();
      if (typeof stored.paused !== "boolean" || !Number.isInteger(stored.callsToday) || stored.callsToday < 0) {
        throw new Error("Invalid alert state");
      }
      return { value: { ...empty, ...stored }, version: result.blob.etag };
    },
    async write(value, version) {
      try {
        await put(PATH, JSON.stringify(value), {
          access: "private",
          addRandomSuffix: false,
          allowOverwrite: version !== null,
          ifMatch: version ?? undefined,
          contentType: "application/json",
          abortSignal: AbortSignal.timeout(4000),
        });
        return true;
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError || (version === null && await readBlob())) return false;
        throw error;
      }
    },
  });
}

export function setPaused(store, paused, event) {
  const now = Date.now();
  return store.update(value => {
    if (event && value.telegramLastDate !== null && (event.date < value.telegramLastDate ||
        (event.date === value.telegramLastDate && event.id <= value.telegramLastUpdate))) return value;
    if (value.paused === paused && !event) return value;
    return {
      ...value,
      paused,
      changedAt: value.paused === paused ? value.changedAt : Math.max(now, (value.changedAt || 0) + 1),
      ...(event ? { telegramLastDate: event.date, telegramLastUpdate: event.id } : {}),
    };
  });
}

export function publicStatus(state) {
  return {
    paused: state.paused,
    changedAt: state.changedAt,
    lastAlertAt: state.lastAlertAt,
    lastSide: state.lastSide,
    callsToday: state.callDate === new Date().toISOString().slice(0, 10) ? state.callsToday : 0,
  };
}
