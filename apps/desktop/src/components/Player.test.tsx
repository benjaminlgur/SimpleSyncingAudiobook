// @vitest-environment node
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
import { Player } from "./Player";

const mocks = vi.hoisted(() => ({
  update: vi.fn(async () => ({ accepted: true, serverPosition: null })),
  audioOptions: {} as { initialChapterIndex?: number; initialPositionMs?: number },
}));
vi.mock("convex/react", () => ({
  useMutation: () => mocks.update,
  useQuery: () => ({ chapterIndex: 0, positionMs: 1000, updatedAt: 100 }),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
vi.mock("../lib/tauri-fs", () => ({ extractCoverArt: async () => null }));
vi.mock("../hooks/useAudioPlayer", () => ({
  useAudioPlayer: (options: typeof mocks.audioOptions) => {
    mocks.audioOptions = options;
    return [{ currentChapterIndex: options.initialChapterIndex, positionMs: options.initialPositionMs, durationMs: 10000, playbackSpeed: 1 }, {}];
  },
}));

let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); });

test("startup waits for the saved offline position even when the remote query is already cached", async () => {
  const data = new Map([[
    "scope:audiobook_sync_local_Book_sum",
    JSON.stringify({ audiobookId: "id", chapterIndex: 1, positionMs: 9000, updatedAt: 200 }),
  ]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  });
  vi.stubGlobal("window", Object.assign(new EventTarget(), { navigator: { onLine: true } }));
  vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
  await act(async () => {
    renderer = create(createElement(Player, {
      book: { name: "Book", checksum: "sum", convexId: "id", folderPath: "books", chapters: [
        { index: 0, filename: "1.mp3" }, { index: 1, filename: "2.mp3" },
      ] },
      convexUrl: "https://test.convex.cloud", storageScope: "scope",
      onBack: vi.fn(), onConvexIdResolved: vi.fn(), onRelocate: vi.fn(),
    }));
  });
  expect(mocks.audioOptions).toMatchObject({ initialChapterIndex: 1, initialPositionMs: 9000 });
});
