/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

beforeEach(() => vi.stubEnv("REQUIRE_AUTH", "false"));
async function fixture() {
  const t = convexTest(schema, import.meta.glob("./**/*.ts"));
  const { audiobookId } = await t.mutation(api.audiobooks.getOrCreate, { name: "Book", checksum: "legacy", chapters: [{ index: 0, filename: "book.mp3" }] });
  const push = (baseRevision: number, positionMs: number, operationId = `op-${baseRevision}`, clientUpdatedAt = 1) => t.mutation(api.positions.update, { audiobookId, chapterIndex: 0, positionMs, baseRevision, operationId, sessionId: "device-session", clientUpdatedAt });
  return { t, audiobookId, push };
}

test("server revisions reject concurrent offline forks regardless of device clock", async () => {
  const { t, audiobookId, push } = await fixture();
  expect(await push(0, 1000)).toMatchObject({ accepted: true, revision: 1 });
  expect(await push(0, 9000, "future-clock", 9999999999999)).toMatchObject({ accepted: false, serverPosition: { positionMs: 1000, revision: 1 } });
  expect(await push(1, 500, "intentional-rewind", -999999)).toMatchObject({ accepted: true, revision: 2 });
  expect(await t.query(api.positions.get, { audiobookId })).toMatchObject({ positionMs: 500, revision: 2 });
});

test("retrying an acknowledged operation is idempotent", async () => {
  const { push } = await fixture();
  expect(await push(0, 1000)).toMatchObject({ revision: 1 });
  expect(await push(0, 1000)).toMatchObject({ accepted: true, revision: 1 });
});

test("adopts 0.x progress lazily and rejects further legacy writes", async () => {
  const { t, audiobookId, push } = await fixture();
  await t.mutation(api.positions.update, { audiobookId, chapterIndex: 0, positionMs: 8000, clientUpdatedAt: 9999999999999 });
  expect(await t.query(api.positions.get, { audiobookId })).toMatchObject({ revision: 0, positionMs: 8000 });
  expect(await push(0, 7000)).toMatchObject({ accepted: true, revision: 1 });
  await expect(t.mutation(api.positions.update, { audiobookId, chapterIndex: 0, positionMs: 9000, clientUpdatedAt: 99999999999999 })).rejects.toThrow("Upgrade all devices");
});

test("recovery history is bounded and account scoped", async () => {
  const { t, audiobookId, push } = await fixture();
  for (let revision = 0; revision < 30; revision++) await push(revision, revision * 1000);
  const history = await t.query(api.positions.history, { audiobookId });
  expect(history).toHaveLength(20);
  expect(history[0].positionMs).toBe(28000);
  await expect(t.withIdentity({ subject: "other|session", issuer: "https://test.example" }).query(api.positions.history, { audiobookId })).rejects.toThrow("Unauthorized");
});

test.each([-1, Infinity, NaN])("rejects invalid position %s", async (value) => {
  const { push } = await fixture();
  await expect(push(0, value)).rejects.toThrow("Invalid playback position");
});

test("identical content with another filename reuses a recording, scoped to the owner", async () => {
  const { t } = await fixture();
  const args = { name: "Original", checksum: `sha256-v1:${"a".repeat(64)}`, chapters: [{ index: 0, filename: "original.mp3" }] };
  const first = await t.mutation(api.audiobooks.getOrCreate, args);
  const second = await t.mutation(api.audiobooks.getOrCreate, { ...args, name: "Renamed", chapters: [{ index: 0, filename: "renamed.mp3" }] });
  expect(second).toEqual({ audiobookId: first.audiobookId, isNew: false });
  const other = await t.withIdentity({ subject: "other|session", issuer: "https://test.example" }).mutation(api.audiobooks.getOrCreate, args);
  expect(other.audiobookId).not.toBe(first.audiobookId);
});

test("link and unlink invalidate observed revisions and preserve both resume points", async () => {
  const { t, audiobookId: a, push } = await fixture();
  const { audiobookId: b } = await t.mutation(api.audiobooks.getOrCreate, { name: "Other edition", checksum: "other", chapters: [] });
  await push(0, 1000);
  await t.mutation(api.positions.update, { audiobookId: b, chapterIndex: 0, positionMs: 9000, clientUpdatedAt: 0, baseRevision: 0, operationId: "b", sessionId: "b" });
  await t.mutation(api.audiobooks.link, { canonicalId: a, linkedId: b });
  const linked = await t.query(api.positions.get, { audiobookId: b });
  expect(linked?.revision).toBe(2);
  expect(await push(1, 1234, "stale-link")).toMatchObject({ accepted: false });
  await t.mutation(api.audiobooks.unlink, { audiobookId: a, peerId: b });
  for (const id of [a, b]) expect(await t.query(api.positions.get, { audiobookId: id })).toMatchObject({ revision: 3, positionMs: linked!.positionMs });
});

test("removing a device retains progress and deleting a root preserves linked copies", async () => {
  const { t, audiobookId: a, push } = await fixture();
  await push(0, 8000);
  await t.mutation(api.audiobooks.registerOnDevice, { audiobookId: a, deviceId: "desktop", platform: "desktop" });
  expect(await t.mutation(api.audiobooks.removeFromDevice, { audiobookId: a, deviceId: "desktop" })).toMatchObject({ deletedAudiobook: false });
  expect(await t.query(api.positions.get, { audiobookId: a })).toMatchObject({ positionMs: 8000 });
  const { audiobookId: b } = await t.mutation(api.audiobooks.getOrCreate, { name: "Copy", checksum: "copy", chapters: [] });
  await t.mutation(api.audiobooks.link, { canonicalId: a, linkedId: b });
  await t.mutation(api.audiobooks.remove, { id: a });
  expect(await t.query(api.positions.get, { audiobookId: b })).toMatchObject({ positionMs: 8000, revision: 3 });
});
