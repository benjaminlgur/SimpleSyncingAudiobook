// @vitest-environment node
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useAudioPlayer, type AudioPlayerControls } from "./useAudioPlayer";

vi.mock("../lib/tauri-fs", () => ({
  loadAudioFileAsBlob: vi.fn(async () => "blob:audio"),
  revokeCurrentAudioBlob: vi.fn(),
  FileNotFoundError: class extends Error {},
}));

class FakeAudio extends EventTarget {
  src = "";
  paused = true;
  currentTime = 0;
  duration = 100;
  playbackRate = 1;
  load() { this.dispatchEvent(new Event("loadedmetadata")); }
  pause() { this.paused = true; }
  async play() { this.paused = false; }
}

let renderer: ReactTestRenderer;
beforeEach(() => { vi.stubGlobal("Audio", FakeAudio); });
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); });

async function mount() {
  let controls!: AudioPlayerControls;
  const update = vi.fn();
  const flush = vi.fn();
  const chapters = [{ index: 0, filename: "1.mp3" }, { index: 1, filename: "2.mp3" }];
  function Player() {
    [, controls] = useAudioPlayer({ folderPath: "books", chapters, onPositionUpdate: update, onChapterChange: flush });
    return null;
  }
  await act(async () => { renderer = create(createElement(Player)); });
  return { get controls() { return controls; }, update, flush };
}

test("a paused seek records the new location before requesting a flush", async () => {
  const player = await mount();
  act(() => player.controls.seekTo(15000));
  expect(player.update).toHaveBeenLastCalledWith(0, 15000);
  expect(player.update.mock.invocationCallOrder[0]).toBeLessThan(player.flush.mock.invocationCallOrder[0]);
  act(() => player.controls.seekBy(30000));
  expect(player.update).toHaveBeenLastCalledWith(0, 45000);
});

test("a paused chapter change publishes the loaded chapter, not the old chapter", async () => {
  const player = await mount();
  await act(async () => { player.controls.skipToChapter(1, 3000); });
  expect(player.update).toHaveBeenLastCalledWith(1, 3000);
  expect(player.update.mock.invocationCallOrder[0]).toBeLessThan(player.flush.mock.invocationCallOrder[0]);
});
