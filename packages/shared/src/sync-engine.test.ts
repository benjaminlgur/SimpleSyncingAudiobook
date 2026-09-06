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
