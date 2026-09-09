/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { SyncEngine, fromSyncPosition, toSyncPosition, type ChapterInfo } from "../packages/shared/src/index";

afterEach(() => vi.unstubAllEnvs());

test.each([
  { legacy: false, queryFirst: false },
  { legacy: false, queryFirst: true },
  { legacy: true, queryFirst: false },
  { legacy: true, queryFirst: true },
])("stale offline listening preserves cloud progress (legacy=$legacy, queryFirst=$queryFirst)", async ({ legacy, queryFirst }) => {
  vi.stubEnv("REQUIRE_AUTH", "false");
  vi.stubEnv("SYNC_ACCESS_KEY", "integration-secret-".repeat(3));
  const syncKey = process.env.SYNC_ACCESS_KEY;
  const t = convexTest(schema, import.meta.glob("./**/*.ts"));
  const { audiobookId } = await t.mutation(api.audiobooks.getOrCreate, { syncKey, name: "Offline book", checksum: "offline", chapters: [] });
  const write = { syncKey, audiobookId, chapterIndex: 0, clientUpdatedAt: 100 };
  if (!legacy) {
    await t.mutation(api.positions.update, { ...write, positionMs: 3600000, baseRevision: -1, operationId: "initial", sessionId: "other-device" });
  }
  await t.mutation(api.positions.update, {
    ...write, positionMs: 7200000,
    ...(legacy ? {} : { baseRevision: 1, operationId: "later", sessionId: "other-device" }),
  });
  const server = (await t.query(api.positions.get, { syncKey, audiobookId }))!;
  // This device last knew hour one; another device has already reached hour two.
  const cache = new Map([["audiobook_sync_local", JSON.stringify({
    audiobookId: "local", chapterIndex: 0, positionMs: 3600000, updatedAt: 50,
    ...(legacy ? {} : { revision: 1, dirty: false }),
  })]]);
  const seek = vi.fn();
  const engine = new SyncEngine("local", {
    getItem: async (key) => cache.get(key) ?? null,
    setItem: async (key, value) => { cache.set(key, value); },
    removeItem: async (key) => { cache.delete(key); },
  }, async (position) => t.mutation(api.positions.update, {
    ...write, chapterIndex: position.chapterIndex, positionMs: position.positionMs,
    clientUpdatedAt: position.updatedAt, baseRevision: position.revision ?? -1,
    operationId: position.operationId, sessionId: position.sessionId,
  }), seek);
  try {
    await engine.initialize();
    vi.spyOn(Date, "now").mockReturnValue(server.updatedAt + 120000);
    await engine.onPlay();
    engine.updatePosition(0, 3720000); // Two minutes of listening to the stale copy.
    expect(engine.getState().pending!.updatedAt).toBeGreaterThan(server.updatedAt);
    if (queryFirst) engine.reconcilePosition(server);
    await engine.onReconnect();
    expect(await t.query(api.positions.get, { syncKey, audiobookId })).toMatchObject({ positionMs: 7200000, revision: server.revision });
    expect(engine.getState().conflict).toMatchObject({ positionMs: 7200000, revision: server.revision });
    engine.updatePosition(0, 3780000); // Continued listening cannot bypass the conflict.
    await engine.manualSync();
    expect(await t.query(api.positions.get, { syncKey, audiobookId })).toMatchObject({ positionMs: 7200000, revision: server.revision });
    await engine.resolveConflict("remote");
    expect(seek).toHaveBeenLastCalledWith(expect.objectContaining({ positionMs: 7200000 }));
    expect(engine.getState().pending).toMatchObject({ positionMs: 7200000, dirty: false });
  } finally { engine.destroy(); vi.restoreAllMocks(); }
});

test("desktop virtual chapters and mobile whole-file playback converge through the real backend protocol", async () => {
  vi.stubEnv("REQUIRE_AUTH", "false"); vi.stubEnv("SYNC_ACCESS_KEY", "integration-secret-".repeat(3));
  const syncKey = process.env.SYNC_ACCESS_KEY;
  const t = convexTest(schema, import.meta.glob("./**/*.ts"));
  const { audiobookId } = await t.mutation(api.audiobooks.getOrCreate, { syncKey, name: "Book", checksum: "legacy", chapters: [] });
  const desktopChapters = [{ index: 0, filename: "book.m4b", startMs: 0, endMs: 30000 }, { index: 1, filename: "book.m4b", startMs: 30000, endMs: 90000 }];
  const mobileChapters = [{ index: 0, filename: "renamed.m4b", startMs: 0 }];
  function device(chapters: ChapterInfo[]) {
    const cache = new Map<string, string>();
    const seek = vi.fn();
    const engine = new SyncEngine("local", { getItem: async (key) => cache.get(key) ?? null, setItem: async (key, value) => { cache.set(key, value); }, removeItem: async (key) => { cache.delete(key); } }, async (position) => {
      const result = await t.mutation(api.positions.update, { syncKey, audiobookId, ...toSyncPosition(chapters, position), clientUpdatedAt: position.updatedAt, baseRevision: position.revision ?? -1, operationId: position.operationId, sessionId: position.sessionId });
      return { ...result, serverPosition: result.serverPosition && { ...result.serverPosition, ...fromSyncPosition(chapters, result.serverPosition) } };
    }, seek);
    return { engine, seek };
  }
  const desktop = device(desktopChapters), mobile = device(mobileChapters);
  try {
    await Promise.all([desktop.engine.initialize(), mobile.engine.initialize()]);
    desktop.engine.updatePosition(1, 5000);
    await desktop.engine.manualSync();
    expect(await t.query(api.positions.get, { syncKey, audiobookId })).toMatchObject({ chapterIndex: 0, positionMs: 35000, revision: 1 });
    mobile.engine.updatePosition(0, 1000);
    await mobile.engine.manualSync();
    expect(mobile.engine.getState().conflict).toMatchObject({ positionMs: 35000 });
    await mobile.engine.resolveConflict("remote");
    expect(mobile.seek).toHaveBeenLastCalledWith(expect.objectContaining({ positionMs: 35000 }));
    mobile.engine.updatePosition(0, 6000); // Deliberate rewind is valid progress.
    await mobile.engine.manualSync();
    const server = (await t.query(api.positions.get, { syncKey, audiobookId }))!;
    desktop.engine.reconcilePosition({ ...server, ...fromSyncPosition(desktopChapters, server) });
    expect(desktop.engine.getState().pending).toMatchObject({ chapterIndex: 0, positionMs: 6000, revision: 2, dirty: false });
    expect(desktop.seek).toHaveBeenLastCalledWith(expect.objectContaining({ chapterIndex: 0, positionMs: 6000 }));
  } finally { desktop.engine.destroy(); mobile.engine.destroy(); }
});
