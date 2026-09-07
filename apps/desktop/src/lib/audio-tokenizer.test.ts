// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import { AudioTokenizer } from "./audio-tokenizer";
import { invoke } from "@tauri-apps/api/core";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (_name: string, args: { length: number }) => Array(args.length).fill(7)) }));
afterEach(() => vi.clearAllMocks());

test("metadata seeks over gigabytes without reading the audio payload", async () => {
  const tokenizer = new AudioTokenizer("huge.m4b", { size: 5_000_000_000, mimeType: "audio/mp4" });
  await tokenizer.ignore(4_000_000_000);
  expect(invoke).not.toHaveBeenCalled();
  const bytes = new Uint8Array(8);
  await tokenizer.peekBuffer(bytes);
  expect(tokenizer.position).toBe(4_000_000_000);
  expect(invoke).toHaveBeenLastCalledWith("read_audio_range", { path: "huge.m4b", offset: 4_000_000_000, length: 8 });
  await tokenizer.readBuffer(bytes);
  expect(tokenizer.position).toBe(4_000_000_008);
});

test("EOF and read budgets are enforced", async () => {
  const tokenizer = new AudioTokenizer("short.mp3", { size: 3, mimeType: "audio/mpeg" }, 5);
  expect(await tokenizer.readBuffer(new Uint8Array(8), { mayBeLess: true })).toBe(3);
  await expect(tokenizer.readBuffer(new Uint8Array(1))).rejects.toThrow();
  await expect(tokenizer.peekBuffer(new Uint8Array(3), { position: 0 })).rejects.toThrow("budget");
});
