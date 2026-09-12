import TrackPlayer, {
  Capability,
  Event,
  State,
} from "react-native-track-player";
import {
  capturePlaybackPosition,
  completePlaybackSetup,
  openPlaybackSession,
  recordNativePosition,
  seekPlaybackSession,
  stopPlaybackSession,
} from "../lib/playbackSession";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

async function until(check: () => Promise<boolean>, message: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error(message);
}

/** Run only from a disposable native test entry with a local 60+ second WAV. */
export async function runNativePlayerSmoke(url: string) {
  const data = new Map<string, string>();
  let stateEvents = 0;
  let progressEvents = 0;
  const subscriptions = [
    TrackPlayer.addEventListener(Event.PlaybackState, () => stateEvents++),
    TrackPlayer.addEventListener(
      Event.PlaybackProgressUpdated,
      () => progressEvents++,
    ),
  ];
  await TrackPlayer.setupPlayer();
  await TrackPlayer.updateOptions({
    capabilities: [Capability.Play, Capability.Pause, Capability.SeekTo],
    progressUpdateEventInterval: 0.5,
  });
  const session = await openPlaybackSession(
    "native-smoke:book",
    "native-smoke",
    [
      { index: 0, filename: "one.wav" },
      { index: 1, filename: "two.wav" },
    ],
    {
      getItem: async (key) => data.get(key) ?? null,
      setItem: async (key, value) => {
        data.set(key, value);
      },
      removeItem: async (key) => {
        data.delete(key);
      },
    },
    async () => ({ accepted: true, serverPosition: null }),
  );
  try {
    session.engine.reconcilePosition({
      chapterIndex: 1,
      positionMs: 15_000,
      revision: 8,
      updatedAt: 100,
    });
    recordNativePosition(session, 0, 3);
    assert(
      session.engine.getState().pending?.positionMs === 15_000,
      "Pre-setup tick overwrote cloud progress",
    );
    await TrackPlayer.add([
      { id: "one", url, title: "Native smoke one", artist: "Test fixture" },
      { id: "two", url, title: "Native smoke two", artist: "Test fixture" },
    ]);
    await completePlaybackSetup(session);
    assert(
      (await TrackPlayer.getActiveTrackIndex()) === 1,
      "Cloud restore chose the wrong chapter",
    );
    assert(
      Math.abs((await TrackPlayer.getProgress()).position - 15) < 0.25,
      "Native seek promise completed before cloud position was applied",
    );
    console.log("PLAYER_SMOKE: restored cloud chapter and position");

    await TrackPlayer.play();
    await until(
      async () => (await TrackPlayer.getProgress()).position > 16,
      "Native playback did not advance",
    );
    await TrackPlayer.setRate(1.5);
    assert(
      (await TrackPlayer.getRate()) === 1.5,
      "Playback speed was not applied",
    );
    await TrackPlayer.pause();
    await until(
      async () => (await TrackPlayer.getPlaybackState()).state === State.Paused,
      "Native pause was not applied",
    );
    const paused = (await TrackPlayer.getProgress()).position;
    await delay(600);
    assert(
      Math.abs((await TrackPlayer.getProgress()).position - paused) < 0.2,
      "Position advanced while paused",
    );
    assert(
      stateEvents > 0 && progressEvents > 0,
      "Native events did not reach the new React host",
    );
    console.log(
      "PLAYER_SMOKE: playback, speed, pause and native events passed",
    );

    await seekPlaybackSession(0, 30_000);
    await capturePlaybackPosition(session);
    assert(
      (await TrackPlayer.getActiveTrackIndex()) === 0,
      "Chapter switch was not applied",
    );
    assert(
      Math.abs((session.engine.getState().pending?.positionMs ?? 0) - 30_000) <
        250,
      "Native seek was not captured by sync",
    );
    await stopPlaybackSession();
    const saved = JSON.parse(
      data.get("audiobook_sync_native-smoke") ?? "null",
    ) as { chapterIndex: number; positionMs: number } | null;
    assert(
      saved?.chapterIndex === 0 && Math.abs(saved.positionMs - 30_000) < 250,
      "Stopping playback lost the saved position",
    );
    console.log("PLAYER_SMOKE: PASS");
  } finally {
    await stopPlaybackSession();
    for (const subscription of subscriptions) subscription.remove();
  }
}
