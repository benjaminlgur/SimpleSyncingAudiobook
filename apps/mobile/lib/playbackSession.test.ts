// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import TrackPlayer, { Event, State } from "react-native-track-player";
import { PlaybackService } from "./trackPlayerService";
import { getPlaybackSession, openPlaybackSession, stopPlaybackSession } from "./playbackSession";

const native = vi.hoisted(() => ({
  position: 0,
  track: 0,
  events: new Map<string, (event: never) => unknown>(),
}));

vi.mock("react-native", () => ({ AppState: { addEventListener: vi.fn() } }));
vi.mock("@react-native-community/netinfo", () => ({ default: { addEventListener: vi.fn() } }));
vi.mock("react-native-track-player", () => ({
  State: { Playing: "playing", Paused: "paused", Buffering: "buffering", Loading: "loading" },
  Event: Object.fromEntries(["PlaybackState", "PlaybackProgressUpdated", "PlaybackActiveTrackChanged", "PlaybackQueueEnded",
    "RemotePlay", "RemotePause", "RemoteStop", "RemoteNext", "RemotePrevious", "RemoteSeek", "RemoteJumpForward", "RemoteJumpBackward"]
    .map((name) => [name, name])),
  default: {
    addEventListener: vi.fn((event, callback) => native.events.set(event, callback)),
    getProgress: vi.fn(async () => ({ position: native.position, duration: 120, buffered: 120 })),
    getActiveTrackIndex: vi.fn(async () => native.track),
    play: vi.fn(async () => native.events.get("PlaybackState")?.({ state: "playing" } as never)),
    pause: vi.fn(async () => native.events.get("PlaybackState")?.({ state: "paused" } as never)),
    reset: vi.fn(async () => { native.position = 0; native.track = 0; }),
    skip: vi.fn(async (track, seconds) => { native.track = track; native.position = seconds; }),
    seekTo: vi.fn(async (seconds) => { native.position = seconds; }),
  },
}));

const data = new Map<string, string>();
const storage = {
  getItem: async (key: string) => data.get(key) ?? null,
  setItem: async (key: string, value: string) => { data.set(key, value); },
  removeItem: async (key: string) => { data.delete(key); },
};
const chapters = [{ index: 0, filename: "1.mp3" }, { index: 1, filename: "2.mp3" }];
const push = vi.fn(async () => ({ accepted: true, serverPosition: null }));

beforeEach(async () => {
  vi.useFakeTimers();
  data.clear(); native.position = 0; native.track = 0; push.mockClear();
  await PlaybackService();
});
afterEach(async () => { await stopPlaybackSession(); await vi.advanceTimersByTimeAsync(0); vi.useRealTimers(); });

test("notification play restarts remote sync after the screen has unsubscribed", async () => {
  const session = await openPlaybackSession("scope:book", "book", chapters, storage, push);
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
  native.events.get(Event.PlaybackProgressUpdated)?.({ track: 0, position: 30 } as never);
  await vi.advanceTimersByTimeAsync(20000);
  expect(push).toHaveBeenCalled();
  expect(session.engine.getState().pending?.positionMs).toBe(30000);
});

test("reopening the same book reuses the active engine and native queue", async () => {
  const first = await openPlaybackSession("scope:book", "book", chapters, storage, push);
  first.ready = true;
  native.position = 40;
  const reopened = await openPlaybackSession("scope:book", "book", chapters, storage, push);
  expect(reopened).toBe(first);
  expect(native.position).toBe(40);
});

test("switching books saves the old native position and disconnect clears the session", async () => {
  const first = await openPlaybackSession("scope:first", "first", chapters, storage, push);
  first.ready = true;
  native.track = 1; native.position = 23;
  await openPlaybackSession("scope:second", "second", chapters, storage, push);
  await vi.advanceTimersByTimeAsync(0);
  expect(JSON.parse(data.get("audiobook_sync_first")!)).toMatchObject({ chapterIndex: 1, positionMs: 23000 });
  await stopPlaybackSession();
  expect(getPlaybackSession()).toBeNull();
});

test("notification seeks while paused are persisted immediately", async () => {
  const session = await openPlaybackSession("scope:book", "book", chapters, storage, push);
  session.ready = true;
  await native.events.get(Event.RemoteSeek)?.({ position: 42 } as never);
  expect(JSON.parse(data.get("audiobook_sync_book")!)).toMatchObject({ positionMs: 42000 });
});
