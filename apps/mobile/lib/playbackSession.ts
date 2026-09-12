import TrackPlayer, { State } from "react-native-track-player";
import {
  SyncEngine,
  fromSyncPosition,
  toSyncPosition,
} from "@audiobook/shared";
import type {
  ChapterInfo,
  StorageAdapter,
  SyncPushFn,
} from "@audiobook/shared";

export interface PlaybackSession {
  key: string;
  engine: SyncEngine;
  chapters: ChapterInfo[];
  ready: boolean;
  playing: boolean;
  error?: string;
  pendingSeek?: {
    chapterIndex: number;
    positionMs: number;
    resolve: () => void;
    reject: (error: Error) => void;
  };
}

let active: PlaybackSession | null = null;
let transition: Promise<unknown> = Promise.resolve();

export function getPlaybackSession(key?: string): PlaybackSession | null {
  return !key || active?.key === key ? active : null;
}

export function openPlaybackSession(
  key: string,
  audiobookId: string,
  chapters: ChapterInfo[],
  storage: StorageAdapter,
  push: SyncPushFn,
  isCurrent: () => boolean = () => true,
): Promise<PlaybackSession> {
  const task = transition.then(async () => {
    if (!isCurrent()) throw new Error("Playback session cancelled");
    if (active?.key === key) {
      active.engine.setPushFn(push);
      return active;
    }
    await stopPlaybackSession();
    if (!isCurrent()) throw new Error("Playback session cancelled");
    const engine = new SyncEngine(audiobookId, storage, push, (position) => {
      if (active?.key !== key) throw new Error("Playback session changed");
      return seekPlaybackSession(position.chapterIndex, position.positionMs);
    });
    const session = { key, engine, chapters, ready: false, playing: false };
    active = session;
    await engine.initialize();
    return session;
  });
  transition = task.catch(() => {});
  return task;
}

export function recordNativePosition(
  session: PlaybackSession,
  track: number,
  seconds: number,
) {
  if (active !== session || !session.ready) return;
  const virtual =
    session.chapters[0]?.endMs !== undefined &&
    session.chapters[0]?.startMs !== undefined;
  const position = virtual
    ? fromSyncPosition(session.chapters, {
        chapterIndex: 0,
        positionMs: seconds * 1000,
      })
    : { chapterIndex: track, positionMs: seconds * 1000 };
  session.engine.updatePosition(position.chapterIndex, position.positionMs);
}

export async function capturePlaybackPosition(session = active) {
  if (!session?.ready || session !== active) return;
  const generation = session.engine.getPlayerGeneration();
  const beforeTrack = await TrackPlayer.getActiveTrackIndex();
  const progress = await TrackPlayer.getProgress();
  const afterTrack = await TrackPlayer.getActiveTrackIndex();
  // A read begun before a remote seek must never inherit that seek's revision.
  if (
    generation !== session.engine.getPlayerGeneration() ||
    beforeTrack !== afterTrack
  )
    return;
  if (afterTrack !== undefined)
    recordNativePosition(session, afterTrack, progress.position);
}

export async function syncPlaybackState(state: State) {
  const session = active;
  if (!session?.ready) return;
  if (state === State.Error) {
    failPlaybackSession(
      "Playback stopped. Check that the chapter files are still available.",
    );
    return;
  }
  await capturePlaybackPosition(session);
  if (active !== session || !session.ready) return;
  const playing = state === State.Playing;
  // Buffering does not represent a user pause.
  if (state === State.Buffering || state === State.Loading) return;
  if (session.playing === playing) return;
  session.playing = playing;
  if (playing) await session.engine.onPlay();
  else await session.engine.onPause();
}

export async function flushPlaybackSession() {
  const session = active;
  if (!session?.ready) return;
  await capturePlaybackPosition(session);
  await session.engine.onBackground();
}

export async function seekPlaybackSession(
  chapterIndex: number,
  positionMs: number,
) {
  const session = active;
  if (!session) throw new Error("Playback session is unavailable");
  if (!session.ready) {
    session.pendingSeek?.resolve();
    return new Promise<void>((resolve, reject) => {
      session.pendingSeek = { chapterIndex, positionMs, resolve, reject };
    });
  }
  await seekNativePosition(session, chapterIndex, positionMs);
}

async function seekNativePosition(
  session: PlaybackSession,
  chapterIndex: number,
  positionMs: number,
) {
  const virtual =
    session.chapters[0]?.endMs !== undefined &&
    session.chapters[0]?.startMs !== undefined;
  if (virtual) {
    await TrackPlayer.seekTo(
      toSyncPosition(session.chapters, { chapterIndex, positionMs })
        .positionMs / 1000,
    );
  } else {
    await TrackPlayer.skip(chapterIndex, positionMs / 1000);
  }
}

// Keep native progress gated until every position received during setup has
// actually been applied. The engine also waits on the queued seek promise.
export async function completePlaybackSetup(session: PlaybackSession) {
  while (session.pendingSeek) {
    const seek = session.pendingSeek;
    session.pendingSeek = undefined;
    try {
      if (active !== session) throw new Error("Playback session changed");
      await seekNativePosition(session, seek.chapterIndex, seek.positionMs);
      seek.resolve();
    } catch (error) {
      seek.reject(
        error instanceof Error
          ? error
          : new Error("Unable to restore playback"),
      );
      throw error;
    }
  }
  if (active === session) {
    session.error = undefined;
    session.ready = true;
  }
}

export function failPlaybackSession(message: string) {
  const session = active;
  if (!session) return;
  session.error = message;
  session.ready = false;
  session.playing = false;
  session.pendingSeek?.reject(new Error(message));
  session.pendingSeek = undefined;
  session.engine.stopTimers();
  session.engine.reportError(message);
}

export async function stopPlaybackSession() {
  const session = active;
  if (!session) return;
  session.pendingSeek?.reject(new Error("Playback session stopped"));
  session.pendingSeek = undefined;
  if (session.ready) {
    try {
      await TrackPlayer.pause();
      await capturePlaybackPosition(session);
    } catch (error) {
      console.warn("Unable to capture native playback before stopping", error);
    }
  }
  active = null;
  await session.engine.saveLocalPosition();
  void session.engine.onClose();
  session.engine.destroy();
  if (session.ready) {
    try {
      await TrackPlayer.reset();
    } catch (error) {
      console.warn("Unable to reset native playback", error);
    }
  }
}
