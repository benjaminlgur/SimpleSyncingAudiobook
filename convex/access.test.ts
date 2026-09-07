/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

afterEach(() => vi.unstubAllEnvs());
const key = "test-secret-".repeat(4);
test("self-hosted deployments fail closed until an access key is configured", async () => {
  vi.stubEnv("REQUIRE_AUTH", "false"); vi.stubEnv("ALLOW_INSECURE_SELF_HOSTED", "false"); vi.stubEnv("SYNC_ACCESS_KEY", "");
  const t = convexTest(schema, import.meta.glob("./**/*.ts"));
  await expect(t.query(api.audiobooks.list, {})).rejects.toThrow("SYNC_ACCESS_KEY");
  vi.stubEnv("SYNC_ACCESS_KEY", key);
  await expect(t.query(api.audiobooks.list, {})).rejects.toThrow("Invalid self-hosted");
  await expect(t.query(api.audiobooks.list, { syncKey: key + "x" })).rejects.toThrow("Invalid self-hosted");
  expect(await t.query(api.authState.checkConnection, { syncKey: key })).toEqual({ protocolVersion: 1 });
  const { audiobookId } = await t.mutation(api.audiobooks.getOrCreate, { syncKey: key, name: "Private", checksum: "sum", chapters: [] });
  await expect(t.query(api.positions.get, { audiobookId })).rejects.toThrow("Invalid self-hosted");
  await expect(t.query(api.positions.history, { audiobookId })).rejects.toThrow("Invalid self-hosted");
  await expect(t.mutation(api.audiobooks.remove, { id: audiobookId })).rejects.toThrow("Invalid self-hosted");
  await expect(t.mutation(api.positions.update, { audiobookId, chapterIndex: 0, positionMs: 0, clientUpdatedAt: 0 })).rejects.toThrow("Invalid self-hosted");
  expect(await t.query(api.audiobooks.list, { syncKey: key })).toHaveLength(1);
});

test("a self-hosted key cannot bypass hosted authentication", async () => {
  vi.stubEnv("REQUIRE_AUTH", "true"); vi.stubEnv("SYNC_ACCESS_KEY", key); vi.stubEnv("ALLOW_INSECURE_SELF_HOSTED", "true");
  const t = convexTest(schema, import.meta.glob("./**/*.ts"));
  await expect(t.query(api.audiobooks.list, { syncKey: key })).rejects.toThrow("Not authenticated");
  expect(await t.withIdentity({ subject: "user|session", issuer: "https://test.example" }).query(api.audiobooks.list, {})).toEqual([]);
});
