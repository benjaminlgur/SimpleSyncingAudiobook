import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SyncEngine } from "./sync-engine";
import type { PlaybackPosition, SyncPushResult } from "./types";

let data: Map<string, string>;
let engines: SyncEngine[];
const accepted: SyncPushResult = { accepted: true, serverPosition: null };
const position = (positionMs: number, updatedAt: number): PlaybackPosition => ({ audiobookId: "book", chapterIndex: 0, positionMs, updatedAt });

beforeEach(() => { data = new Map(); engines = []; vi.useFakeTimers(); });
afterEach(() => { engines.forEach((engine) => engine.destroy()); vi.useRealTimers(); });

function create(push = vi.fn(async (_position: PlaybackPosition): Promise<SyncPushResult> => accepted)) {
  const engine = new SyncEngine("book", {
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => { data.set(key, value); },
    removeItem: async (key) => { data.delete(key); },
  }, push);
  engines.push(engine);
  return engine;
}

test("offline progress wins over an older server position regardless of initialization order", async () => {
  data.set("audiobook_sync_book", JSON.stringify(position(9000, 200)));
  const engine = create();
  engine.reconcilePosition(position(1000, 100));
  await engine.initialize();
  expect(engine.reconcilePosition(position(1000, 100))).toMatchObject(position(9000, 200));
});

test("newer remote progress is adopted without changing its timestamp", async () => {
  const engine = create();
  await engine.initialize();
  engine.reconcilePosition(position(9000, 200));
  engine.updatePosition(0, 9000);
  expect(engine.getState().pending?.updatedAt).toBe(200);
});

test("a successful pause and close retain the offline resume position", async () => {
  const engine = create();
  engine.updatePosition(3, 90000);
  await engine.onPause();
  await engine.onClose();
  expect(await create().initialize()).toMatchObject({ chapterIndex: 3, positionMs: 90000 });
});

test("a slow acknowledgement cannot erase progress recorded during the push", async () => {
  let finish!: (result: SyncPushResult) => void;
  const engine = create(vi.fn(() => new Promise<SyncPushResult>((resolve) => { finish = resolve; })));
  engine.updatePosition(0, 1000);
  const first = engine.manualSync();
  await vi.advanceTimersByTimeAsync(0);
  engine.updatePosition(0, 9000);
  engine.startTimers(false);
  await vi.advanceTimersByTimeAsync(2000);
  finish(accepted);
  await first;
  expect(await create().initialize()).toMatchObject({ positionMs: 9000 });
});

test("closing during an in-flight push flushes the last position afterwards", async () => {
  let finish!: (result: SyncPushResult) => void;
  const push = vi.fn(async (_position: PlaybackPosition): Promise<SyncPushResult> => accepted)
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const engine = create(push);
  engine.updatePosition(0, 1000);
  const first = engine.manualSync();
  await vi.advanceTimersByTimeAsync(0);
  engine.updatePosition(1, 2000);
  const close = engine.onClose();
  await vi.advanceTimersByTimeAsync(0);
  finish(accepted);
  await Promise.all([first, close]);
  expect(push.mock.calls.map(([p]) => p.positionMs)).toEqual([1000, 2000]);
});

test("a rejected stale request cannot overwrite a seek made while it was in flight", async () => {
  let finish!: (result: SyncPushResult) => void;
  const engine = create(vi.fn(() => new Promise<SyncPushResult>((resolve) => { finish = resolve; })));
  engine.updatePosition(0, 1000);
  const first = engine.manualSync();
  await vi.advanceTimersByTimeAsync(0);
  engine.updatePosition(4, 8000);
  finish({ accepted: false, serverPosition: position(2000, Date.now() + 100) });
  await first;
  expect(engine.getState().pending).toMatchObject({ chapterIndex: 4, positionMs: 8000 });
});

test("acknowledged revisions stay durable and are not pushed again on restart", async () => {
  const push = vi.fn(async (): Promise<SyncPushResult> => ({ accepted: true, revision: 1, serverPosition: null }));
  const engine = create(push);
  engine.updatePosition(0, 1000);
  await engine.manualSync();
  const restored = create(push);
  expect(await restored.initialize()).toMatchObject({ revision: 1, dirty: false, positionMs: 1000 });
  await restored.manualSync();
  expect(push).toHaveBeenCalledTimes(1);
});

test("offline forks survive restart and require an explicit choice", async () => {
  const engine = create(vi.fn(async (): Promise<SyncPushResult> => ({ accepted: false, serverPosition: { ...position(2000, 1), revision: 2 } })));
  engine.reconcilePosition({ ...position(500, 1), revision: 1 });
  engine.updatePosition(0, 8000);
  await engine.manualSync();
  const push = vi.fn(async (): Promise<SyncPushResult> => ({ accepted: true, revision: 3, serverPosition: null }));
  const restored = create(push);
  await restored.initialize();
  expect(restored.getState()).toMatchObject({ pending: { positionMs: 8000 }, conflict: { positionMs: 2000, revision: 2 } });
  await restored.manualSync();
  expect(push).not.toHaveBeenCalled();
  await restored.resolveConflict("local");
  expect(push.mock.calls).toHaveLength(1);
  expect(restored.getState()).toMatchObject({ pending: { positionMs: 8000, revision: 3, dirty: false }, conflict: null });
});

test("choosing the other device does not write local progress over it", async () => {
  const push = vi.fn(async (): Promise<SyncPushResult> => accepted);
  const engine = create(push);
  engine.updatePosition(0, 8000);
  engine.reconcilePosition({ ...position(2000, 1), revision: 2 });
  await engine.resolveConflict("remote");
  expect(engine.getState().pending).toMatchObject({ revision: 2, positionMs: 2000, dirty: false });
  expect(push).not.toHaveBeenCalled();
});

test("a subscription acknowledging our in-flight write is not a conflict", async () => {
  let finish!: (result: SyncPushResult) => void;
  const engine = create(vi.fn(() => new Promise<SyncPushResult>((resolve) => { finish = resolve; })));
  engine.updatePosition(0, 1000);
  const sent = engine.getState().pending!;
  const syncing = engine.manualSync();
  await vi.advanceTimersByTimeAsync(0);
  engine.updatePosition(0, 2000);
  engine.reconcilePosition({ ...sent, revision: 1 });
  finish({ accepted: true, revision: 1, serverPosition: null });
  await syncing;
  expect(engine.getState().conflict).toBeFalsy();
  expect(engine.getState().pending).toMatchObject({ positionMs: 2000, revision: 1, dirty: true });
});

test("invalid player samples cannot corrupt saved progress", () => {
  const engine = create();
  engine.updatePosition(0, 1000);
  engine.updatePosition(-1, NaN);
  engine.updatePosition(0, Infinity);
  expect(engine.getState().pending?.positionMs).toBe(1000);
});

test("a stale subscription cannot create a false conflict after an acknowledgement", async () => {
  const engine = create(vi.fn(async (): Promise<SyncPushResult> => ({ accepted: true, revision: 2, serverPosition: null })));
  engine.reconcilePosition({ ...position(1000, 1), revision: 1 });
  engine.updatePosition(0, 2000);
  await engine.manualSync();
  engine.updatePosition(0, 3000);
  engine.reconcilePosition({ ...position(1000, 1), revision: 1 });
  expect(engine.getState().conflict).toBeFalsy();
  expect(engine.getState().pending).toMatchObject({ revision: 2, positionMs: 3000 });
});

test("a failed local save is surfaced and does not claim a successful sync", async () => {
  const push = vi.fn(async () => accepted);
  const engine = new SyncEngine("book", { getItem: async () => null, setItem: async () => { throw new Error("Disk full"); }, removeItem: async () => {} }, push);
  engines.push(engine);
  engine.updatePosition(0, 8000);
  await engine.manualSync();
  expect(push).not.toHaveBeenCalled();
  expect(engine.getState()).toMatchObject({ status: "error", lastError: "Disk full", pending: { positionMs: 8000 } });
});

test("native samples during an asynchronous conflict seek cannot undo the chosen position", async () => {
  let completeSeek!: () => void;
  const engine = new SyncEngine("book", { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} }, async () => accepted,
    () => new Promise<void>((resolve) => { completeSeek = resolve; }));
  engines.push(engine);
  engine.updatePosition(0, 8000);
  engine.reconcilePosition({ ...position(2000, 1), revision: 2 });
  const choosing = engine.resolveConflict("remote");
  engine.updatePosition(0, 8500);
  completeSeek();
  await choosing;
  expect(engine.getState().pending).toMatchObject({ revision: 2, positionMs: 2000, dirty: false });
});
