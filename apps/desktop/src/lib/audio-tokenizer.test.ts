// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import { AudioTokenizer } from "./audio-tokenizer";
import { invoke } from "@tauri-apps/api/core";
import { parseFromTokenizer } from "music-metadata";
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (_name: string, args: { length: number }) =>
    Array(args.length).fill(7),
  ),
}));
afterEach(() => vi.clearAllMocks());

test("metadata seeks over gigabytes without reading the audio payload", async () => {
  const tokenizer = new AudioTokenizer("huge.m4b", {
    size: 5_000_000_000,
    mimeType: "audio/mp4",
  });
  await tokenizer.ignore(4_000_000_000);
  expect(invoke).not.toHaveBeenCalled();
  const bytes = new Uint8Array(8);
  await tokenizer.peekBuffer(bytes);
  expect(tokenizer.position).toBe(4_000_000_000);
  expect(invoke).toHaveBeenLastCalledWith("read_audio_range", {
    path: "huge.m4b",
    offset: 4_000_000_000,
    length: 8,
  });
  await tokenizer.readBuffer(bytes);
  expect(tokenizer.position).toBe(4_000_000_008);
});

test("EOF and read budgets are enforced", async () => {
  const tokenizer = new AudioTokenizer(
    "short.mp3",
    { size: 3, mimeType: "audio/mpeg" },
    5,
  );
  expect(
    await tokenizer.readBuffer(new Uint8Array(8), { mayBeLess: true }),
  ).toBe(3);
  await expect(tokenizer.readBuffer(new Uint8Array(1))).rejects.toThrow();
  await expect(
    tokenizer.peekBuffer(new Uint8Array(3), { position: 0 }),
  ).rejects.toThrow("budget");
});

test("the real metadata parser can scan trailing tags and rewind to the audio header", async () => {
  const wave = Buffer.alloc(44 + 32000);
  wave.write("RIFF");
  wave.writeUInt32LE(wave.length - 8, 4);
  wave.write("WAVEfmt ", 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(16000, 24);
  wave.writeUInt32LE(32000, 28);
  wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34);
  wave.write("data", 36);
  wave.writeUInt32LE(32000, 40);
  vi.mocked(invoke).mockImplementation(async (_command, args) => {
    const { offset, length } = args as { offset: number; length: number };
    return Array.from(wave.subarray(offset, offset + length));
  });
  const tokenizer = new AudioTokenizer(
    "generated.wav",
    { size: wave.length, mimeType: "audio/wav" },
    1024,
  );
  const metadata = await parseFromTokenizer(tokenizer);
  expect(metadata.format.duration).toBe(1);
  expect(metadata.format.sampleRate).toBe(16000);
  expect(metadata.format.numberOfChannels).toBe(1);
});
