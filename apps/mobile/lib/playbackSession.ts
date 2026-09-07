import TrackPlayer, { State } from "react-native-track-player";
import { SyncEngine, fromSyncPosition, toSyncPosition } from "@audiobook/shared";
import type { ChapterInfo, StorageAdapter, SyncPushFn } from "@audiobook/shared";

export interface PlaybackSession {
  key: string;
  engine: SyncEngine;
  chapters: ChapterInfo[];
  ready: boolean;
  playing: boolean;
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

export function recordNativePosition(session: PlaybackSession, track: number, seconds: number) {
  if (active !== session || !session.ready) return;
  const virtual = session.chapters[0]?.endMs !== undefined && session.chapters[0]?.startMs !== undefined;
  const position = virtual
    ? fromSyncPosition(session.chapters, { chapterIndex: 0, positionMs: seconds * 1000 })
    : { chapterIndex: track, positionMs: seconds * 1000 };
  session.engine.updatePosition(position.chapterIndex, position.positionMs);
}

export async function capturePlaybackPosition(session = active) {
  if (!session?.ready || session !== active) return;
  const [progress, track] = await Promise.all([TrackPlayer.getProgress(), TrackPlayer.getActiveTrackIndex()]);
  if (track !== undefined) recordNativePosition(session, track, progress.position);
}

export async function syncPlaybackState(state: State) {
  const session = active;
  if (!session?.ready) return;
  await capturePlaybackPosition(session);
  if (active !== session) return;
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

export async function seekPlaybackSession(chapterIndex: number, positionMs: number) {
  const session = active;
  if (!session?.ready) return;
  const virtual = session.chapters[0]?.endMs !== undefined && session.chapters[0]?.startMs !== undefined;
  if (virtual) {
    await TrackPlayer.seekTo(toSyncPosition(session.chapters, { chapterIndex, positionMs }).positionMs / 1000);
  } else {
    await TrackPlayer.skip(chapterIndex, positionMs / 1000);
  }
  await capturePlaybackPosition(session);
}

export async function stopPlaybackSession() {
  const session = active;
  if (!session) return;
  if (session.ready) {
    try {
      await TrackPlayer.pause();
      await capturePlaybackPosition(session);
    } catch (error) {
      console.warn("Unable to capture native playback before stopping", error);
    }
  }
  active = null;
  void session.engine.onClose();
  session.engine.destroy();
  if (session.ready) {
    try { await TrackPlayer.reset(); } catch (error) { console.warn("Unable to reset native playback", error); }
  }
}
