// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import * as FileSystem from "expo-file-system/legacy";
import { extractCoverArtFromAudioUris } from "./coverArt";

vi.mock("expo-file-system/legacy", () => ({
  EncodingType: { Base64: "base64" },
  readAsStringAsync: vi.fn(),
}));
beforeEach(() => vi.resetAllMocks());

test("missing or corrupt cover data falls back to the next chapter without unbounded reads", async () => {
  vi.mocked(FileSystem.readAsStringAsync).mockRejectedValueOnce(
    new Error("Missing chapter"),
  );
  const jpeg = Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    ...Array<number>(16).fill(0),
    0xff,
    0xd9,
  ]);
  vi.mocked(FileSystem.readAsStringAsync).mockResolvedValue(
    jpeg.toString("base64"),
  );
  expect(
    await extractCoverArtFromAudioUris([
      "file:///missing.m4b",
      "file:///cover.m4b",
    ]),
  ).toBe(`data:image/jpeg;base64,${jpeg.toString("base64")}`);
  for (const [, options] of vi.mocked(FileSystem.readAsStringAsync).mock.calls)
    expect(options?.length).toBeLessThanOrEqual(8 * 1024 * 1024);
});

test("malformed huge ID3 lengths are bounded and return placeholder artwork", async () => {
  vi.mocked(FileSystem.readAsStringAsync).mockResolvedValue(
    Buffer.from([73, 68, 51, 4, 0, 0, 127, 127, 127, 127]).toString("base64"),
  );
  expect(
    await extractCoverArtFromAudioUris(["file:///corrupt.mp3"]),
  ).toBeNull();
  for (const [, options] of vi.mocked(FileSystem.readAsStringAsync).mock.calls)
    expect(options?.length).toBeLessThanOrEqual(8 * 1024 * 1024);
});
