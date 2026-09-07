/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
beforeEach(() => (vi.stubEnv("REQUIRE_AUTH", "false"), vi.stubEnv("ALLOW_INSECURE_SELF_HOSTED", "true")));
afterEach(() => vi.unstubAllEnvs());

async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await Promise.all(["A", "B", "C"].map(async (checksum) =>
    (await t.mutation(api.audiobooks.getOrCreate, { name: "Book", checksum, chapters: [] })).audiobookId));
  const [a, b, c] = ids;
  return { t, a, b, c };
}

test("linking via an already linked copy shares the newest position across all three", async () => {
  const { t, a, b, c } = await fixture();
  await t.mutation(api.positions.update, { audiobookId: a, chapterIndex: 1, positionMs: 1000, clientUpdatedAt: 10 });
  await t.mutation(api.positions.update, { audiobookId: c, chapterIndex: 3, positionMs: 9000, clientUpdatedAt: 20 });
  await t.mutation(api.audiobooks.link, { canonicalId: a, linkedId: b });
  await t.mutation(api.audiobooks.link, { canonicalId: b, linkedId: c });
  for (const id of [a, b, c]) {
    expect(await t.query(api.positions.get, { audiobookId: id })).toMatchObject({ chapterIndex: 3, positionMs: 9000 });
  }
  await t.mutation(api.positions.update, { audiobookId: b, chapterIndex: 4, positionMs: 2000, clientUpdatedAt: 30 });
  expect(await t.query(api.positions.get, { audiobookId: c })).toMatchObject({ chapterIndex: 4 });
  expect(await t.query(api.audiobooks.getLinked, { audiobookId: b })).toHaveLength(2);
});

test("legacy chains and cycles resolve consistently without hanging", async () => {
  const { t, a, b, c } = await fixture();
  await t.run(async (ctx) => {
    for (const [canonicalId, linkedId] of [[a, b], [b, c], [c, a]]) {
      await ctx.db.insert("audiobookLinks", { canonicalId, linkedId, userId: "self-hosted" });
    }
    await ctx.db.insert("positions", { audiobookId: c, chapterIndex: 2, positionMs: 456, updatedAt: 50, userId: "self-hosted" });
  });
  for (const id of [a, b, c]) {
    expect(await t.query(api.positions.get, { audiobookId: id })).toMatchObject({ positionMs: 456 });
  }
  await t.mutation(api.audiobooks.link, { canonicalId: a, linkedId: c });
  const links = await t.run((ctx) => ctx.db.query("audiobookLinks").collect());
  expect(links).toHaveLength(2);
  expect(new Set(links.map((link) => link.canonicalId)).size).toBe(1);
});

test("unlinking siblings preserves progress and separates future updates", async () => {
  const { t, a, b, c } = await fixture();
  await t.mutation(api.audiobooks.link, { canonicalId: a, linkedId: b });
  await t.mutation(api.audiobooks.link, { canonicalId: a, linkedId: c });
  await t.mutation(api.positions.update, { audiobookId: b, chapterIndex: 1, positionMs: 5000, clientUpdatedAt: 10 });
  expect(await t.mutation(api.audiobooks.unlink, { audiobookId: b, peerId: c })).toBe(true);
  await t.mutation(api.positions.update, { audiobookId: b, chapterIndex: 2, positionMs: 1000, clientUpdatedAt: 20 });
  expect(await t.query(api.positions.get, { audiobookId: c })).toMatchObject({ chapterIndex: 1, positionMs: 5000 });
});

test("self-links and links to another user's books are rejected", async () => {
  const { t, a, b } = await fixture();
  await expect(t.mutation(api.audiobooks.link, { canonicalId: a, linkedId: a })).rejects.toThrow("itself");
  const other = t.withIdentity({ subject: "other-user|session", issuer: "https://test.example" });
  await expect(other.mutation(api.audiobooks.link, { canonicalId: a, linkedId: b })).rejects.toThrow("Unauthorized");
});
