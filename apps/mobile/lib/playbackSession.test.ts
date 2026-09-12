// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import TrackPlayer, { Event } from "react-native-track-player";
import { PlaybackService } from "./trackPlayerService";
import {
  completePlaybackSetup,
  capturePlaybackPosition,
  getPlaybackSession,
  openPlaybackSession,
  recordNativePosition,
  stopPlaybackSession,
} from "./playbackSession";

const native = vi.hoisted(() => ({
  position: 0,
  track: 0,
  events: new Map<string, (event: never) => unknown>(),
}));

vi.mock("react-native", () => ({ AppState: { addEventListener: vi.fn() } }));
vi.mock("@react-native-community/netinfo", () => ({
  default: { addEventListener: vi.fn() },
}));
vi.mock("react-native-track-player", () => ({
  State: {
    Playing: "playing",
    Paused: "paused",
    Buffering: "buffering",
    Loading: "loading",
  },
  Event: Object.fromEntries(
    [
      "PlaybackState",
      "PlaybackProgressUpdated",
      "PlaybackActiveTrackChanged",
      "PlaybackQueueEnded",
      "RemotePlay",
      "RemotePause",
      "RemoteStop",
      "RemoteNext",
      "RemotePrevious",
      "RemoteSeek",
      "RemoteJumpForward",
      "RemoteJumpBackward",
    ].map((name) => [name, name]),
  ),
  default: {
    addEventListener: vi.fn((event, callback) =>
      native.events.set(event, callback),
    ),
    getProgress: vi.fn(async () => ({
      position: native.position,
      duration: 120,
      buffered: 120,
    })),
    getActiveTrackIndex: vi.fn(async () => native.track),
    play: vi.fn(async () =>
      native.events.get("PlaybackState")?.({ state: "playing" } as never),
    ),
    pause: vi.fn(async () =>
      native.events.get("PlaybackState")?.({ state: "paused" } as never),
    ),
    reset: vi.fn(async () => {
      native.position = 0;
      native.track = 0;
    }),
    skip: vi.fn(async (track, seconds) => {
      native.track = track;
      native.position = seconds;
    }),
    seekTo: vi.fn(async (seconds) => {
      native.position = seconds;
    }),
  },
}));

const data = new Map<string, string>();
const storage = {
  getItem: async (key: string) => data.get(key) ?? null,
  setItem: async (key: string, value: string) => {
    data.set(key, value);
  },
  removeItem: async (key: string) => {
    data.delete(key);
  },
};
const chapters = [
  { index: 0, filename: "1.mp3" },
  { index: 1, filename: "2.mp3" },
];
const push = vi.fn(async () => ({ accepted: true, serverPosition: null }));

beforeEach(async () => {
  vi.useFakeTimers();
  data.clear();
  native.position = 0;
  native.track = 0;
  push.mockClear();
  await PlaybackService();
});
afterEach(async () => {
  await stopPlaybackSession();
  await vi.advanceTimersByTimeAsync(0);
  vi.useRealTimers();
});

test("notification play restarts remote sync after the screen has unsubscribed", async () => {
  const session = await openPlaybackSession(
    "scope:book",
    "book",
    chapters,
    storage,
    push,
  );
  session.ready = true;
  const unsubscribe = session.engine.subscribe(() => {});
  unsubscribe(); // Navigation removes the UI, but the service still owns sync.
  await TrackPlayer.play();
  await vi.advanceTimersByTimeAsync(0);
  native.position = 15;
  await TrackPlayer.pause();
  await vi.advanceTimersByTimeAsync(0);
  expect(session.engine.getState().pending?.positionMs).toBe(15000);
  expect(push).toHaveBeenCalled();
  push.mockClear();
  await TrackPlayer.play();
  await vi.advanceTimersByTimeAsync(0);
  native.position = 30;
  native.events.get(Event.PlaybackProgressUpdated)?.({
    track: 0,
    position: 30,
  } as never);
  await vi.advanceTimersByTimeAsync(20000);
  expect(push).toHaveBeenCalled();
  expect(session.engine.getState().pending?.positionMs).toBe(30000);
});

test("reopening the same book reuses the active engine and native queue", async () => {
  const first = await openPlaybackSession(
    "scope:book",
    "book",
    chapters,
    storage,
    push,
  );
  first.ready = true;
  native.position = 40;
  const reopened = await openPlaybackSession(
    "scope:book",
    "book",
    chapters,
    storage,
    push,
  );
  expect(reopened).toBe(first);
  expect(native.position).toBe(40);
});

test("switching books saves the old native position and disconnect clears the session", async () => {
  const first = await openPlaybackSession(
    "scope:first",
    "first",
    chapters,
    storage,
    push,
  );
  first.ready = true;
  native.track = 1;
  native.position = 23;
  await openPlaybackSession("scope:second", "second", chapters, storage, push);
  await vi.advanceTimersByTimeAsync(0);
  expect(JSON.parse(data.get("audiobook_sync_first")!)).toMatchObject({
    chapterIndex: 1,
    positionMs: 23000,
  });
  await stopPlaybackSession();
  expect(getPlaybackSession()).toBeNull();
});

test("notification seeks while paused are persisted immediately", async () => {
  const session = await openPlaybackSession(
    "scope:book",
    "book",
    chapters,
    storage,
    push,
  );
  session.ready = true;
  await native.events.get(Event.RemoteSeek)?.({ position: 42 } as never);
  expect(JSON.parse(data.get("audiobook_sync_book")!)).toMatchObject({
    positionMs: 42000,
  });
});

test("cloud position received before native setup cannot be overwritten by stale native ticks", async () => {
  const session = await openPlaybackSession(
    "scope:late-cloud",
    "late-cloud",
    chapters,
    storage,
    push,
  );
  session.engine.reconcilePosition({
    chapterIndex: 1,
    positionMs: 7200000,
    revision: 8,
    updatedAt: 100,
  });
  recordNativePosition(session, 0, 3);
  expect(session.ready).toBe(false);
  expect(session.engine.getState().pending).toMatchObject({
    positionMs: 7200000,
    dirty: false,
  });
  await completePlaybackSetup(session);
  await vi.advanceTimersByTimeAsync(0);
  expect(native.track).toBe(1);
  expect(native.position).toBe(7200);
  recordNativePosition(session, 1, 7202);
  await session.engine.manualSync();
  expect(push).toHaveBeenLastCalledWith(
    expect.objectContaining({
      chapterIndex: 1,
      positionMs: 7202000,
      revision: 8,
    }),
  );
});

test("failed native restore never authorizes stale playback to overwrite cloud progress", async () => {
  const session = await openPlaybackSession(
    "scope:failed-seek",
    "failed-seek",
    chapters,
    storage,
    push,
  );
  session.ready = true;
  vi.mocked(TrackPlayer.skip).mockRejectedValueOnce(
    new Error("Chapter missing"),
  );
  session.engine.reconcilePosition({
    chapterIndex: 1,
    positionMs: 7200000,
    revision: 8,
    updatedAt: 100,
  });
  await vi.advanceTimersByTimeAsync(0);
  recordNativePosition(session, 0, 180);
  await session.engine.onReconnect();
  expect(push).not.toHaveBeenCalled();
  expect(session.engine.getState()).toMatchObject({
    status: "error",
    pending: { positionMs: 7200000, revision: 8, dirty: false },
  });
});

test("an old native read completing after a cloud seek cannot inherit the new revision", async () => {
  const session = await openPlaybackSession(
    "scope:read-race",
    "read-race",
    chapters,
    storage,
    push,
  );
  session.ready = true;
  let finishRead!: (progress: {
    position: number;
    duration: number;
    buffered: number;
  }) => void;
  vi.mocked(TrackPlayer.getProgress).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishRead = resolve;
      }),
  );
  const capturing = capturePlaybackPosition(session);
  await Promise.resolve();
  session.engine.reconcilePosition({
    chapterIndex: 0,
    positionMs: 7200000,
    revision: 8,
    updatedAt: 100,
  });
  await vi.advanceTimersByTimeAsync(0);
  finishRead({ position: 3, duration: 8000, buffered: 8000 });
  await capturing;
  await session.engine.onReconnect();
  expect(push).not.toHaveBeenCalled();
  expect(session.engine.getState().pending).toMatchObject({
    positionMs: 7200000,
    revision: 8,
    dirty: false,
  });
});
