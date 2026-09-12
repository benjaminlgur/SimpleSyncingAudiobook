// @vitest-environment node
import { expect, test, vi } from "vitest";
import { scanM4bFile } from "./tauri-fs";
import { parseFromTokenizer } from "music-metadata";
import { readMp4ChapterList } from "./mp4-chapters";

vi.mock("./mp4-chapters", () => ({
  readMp4ChapterList: vi.fn(async () => []),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string) =>
    command === "audio_file_size" ? 1000 : "a".repeat(64),
  ),
  convertFileSrc: (path: string) => `asset:${path}`,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("music-metadata", () => ({
  parseFromTokenizer: vi.fn(async () => ({
    format: {
      duration: 120,
      sampleRate: 44100,
      chapters: [
        { title: "First", start: 0, timeScale: 1000 },
        { title: "Second", start: 60000, timeScale: 1000 },
      ],
    },
  })),
}));

test("imports embedded chapters from the parser's format data using the track timescale", async () => {
  const book = await scanM4bFile("/books/book.m4b");
  expect(parseFromTokenizer).toHaveBeenCalledWith(expect.any(Object), {
    includeChapters: true,
    skipCovers: true,
  });
  expect(book?.chapters).toMatchObject([
    { index: 0, title: "First", startMs: 0, endMs: 60000 },
    { index: 1, title: "Second", startMs: 60000, endMs: 120000 },
  ]);
});

test("uses explicit MP4 chapters without invoking unsupported chapter-track parsing", async () => {
  vi.mocked(readMp4ChapterList).mockResolvedValueOnce([
    { title: "Opening", startMs: 0 },
    { title: "Second section", startMs: 60000 },
  ]);
  const book = await scanM4bFile("/books/book.m4b");
  expect(parseFromTokenizer).toHaveBeenLastCalledWith(expect.any(Object), {
    includeChapters: false,
    skipCovers: true,
  });
  expect(book?.chapters).toMatchObject([
    { index: 0, title: "Opening", startMs: 0, endMs: 60000 },
    { index: 1, title: "Second section", startMs: 60000, endMs: 120000 },
  ]);
});
