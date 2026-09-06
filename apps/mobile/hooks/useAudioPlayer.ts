import { useState, useEffect, useCallback, useRef } from "react";
import TrackPlayer, {
  State,
  Event,
  usePlaybackState,
  useProgress,
  useTrackPlayerEvents,
  Capability,
  AppKilledPlaybackBehavior,
} from "react-native-track-player";
import type { ChapterInfo } from "@audiobook/shared";
import { fromSyncPosition, toSyncPosition } from "@audiobook/shared";
import { capturePlaybackPosition, flushPlaybackSession, getPlaybackSession, seekPlaybackSession, syncPlaybackState } from "../lib/playbackSession";

export interface MobilePlayerState {
  isPlaying: boolean;
  currentChapterIndex: number;
  positionMs: number;
  durationMs: number;
  playbackSpeed: number;
  isLoading: boolean;
  error: string | null;
}

export interface MobilePlayerControls {
  play: () => Promise<void>;
  pause: () => Promise<void>;
  togglePlayPause: () => Promise<void>;
  seekTo: (ms: number) => Promise<void>;
  seekBy: (deltaMs: number) => Promise<void>;
  skipToChapter: (index: number, seekMs?: number) => Promise<void>;
  nextChapter: () => Promise<void>;
  prevChapter: () => Promise<void>;
  setSpeed: (speed: number) => Promise<void>;
}

let setup: Promise<void> | undefined;

async function setupPlayer() {
  setup ??= (async () => {
    try {
      await TrackPlayer.setupPlayer();
    } catch (error) {
      if ((error as { code?: string }).code !== "player_already_initialized") throw error;
    }
    await TrackPlayer.updateOptions({
      android: { appKilledPlaybackBehavior: AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification },
      capabilities: [Capability.Play, Capability.Pause, Capability.SkipToNext, Capability.SkipToPrevious,
        Capability.JumpForward, Capability.JumpBackward, Capability.SeekTo],
      compactCapabilities: [Capability.Play, Capability.Pause, Capability.SkipToNext],
      forwardJumpInterval: 30,
      backwardJumpInterval: 30,
      progressUpdateEventInterval: 2,
    });
  })().catch((error: unknown) => { setup = undefined; throw error; });
  await setup;
}

interface UseAudioPlayerOptions {
  sessionKey: string;
  fileUris: string[];
  chapters: ChapterInfo[];
  initialChapterIndex?: number;
  initialPositionMs?: number;
  onPositionUpdate?: (chapterIndex: number, positionMs: number) => void;
  onChapterChange?: (chapterIndex: number) => void;
  onPause?: () => void;
  onPlay?: () => void;
}

export function useMobileAudioPlayer(options: UseAudioPlayerOptions): [MobilePlayerState, MobilePlayerControls] {
  const { sessionKey, fileUris, chapters, initialChapterIndex = 0, initialPositionMs = 0 } = options;
  const callbacks = useRef(options);
  callbacks.current = options;
  const virtual = chapters[0]?.startMs !== undefined && chapters[0]?.endMs !== undefined;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(initialChapterIndex);
  const [speed, setSpeed] = useState(1);
  const playbackState = usePlaybackState();
  const progress = useProgress(250);
  const isPlaying = playbackState.state === State.Playing;
  const chapterIndex = virtual
    ? fromSyncPosition(chapters, { chapterIndex: 0, positionMs: progress.position * 1000 }).chapterIndex
    : currentTrackIndex;
  const indexRef = useRef(chapterIndex);
  indexRef.current = chapterIndex;

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const session = getPlaybackSession(sessionKey);
      if (!session) throw new Error("Playback session is unavailable");
      await setupPlayer();
      if (!mounted || getPlaybackSession() !== session) return;
      if (!session.ready) {
        await TrackPlayer.reset();
        const tracks = (virtual ? fileUris.slice(0, 1) : fileUris).map((url, i) => ({
          id: sessionKey + ":" + i, url,
          title: chapters[i]?.title || chapters[i]?.filename || "Audiobook",
          artist: "Audiobook",
        }));
        await TrackPlayer.add(tracks);
        const position = virtual
          ? toSyncPosition(chapters, { chapterIndex: initialChapterIndex, positionMs: initialPositionMs })
          : { chapterIndex: initialChapterIndex, positionMs: initialPositionMs };
        await TrackPlayer.skip(position.chapterIndex, position.positionMs / 1000);
        session.ready = true;
      }
      const track = await TrackPlayer.getActiveTrackIndex();
      if (mounted) {
        setCurrentTrackIndex(track ?? 0);
        setSpeed(await TrackPlayer.getRate());
        setReady(true);
      }
    })().catch((cause: unknown) => {
      if (mounted) setError(cause instanceof Error ? cause.message : "Failed to load audio");
    });
    return () => {
      mounted = false;
      if (getPlaybackSession(sessionKey)?.ready) void flushPlaybackSession();
    };
  }, [sessionKey]);

  useTrackPlayerEvents([Event.PlaybackActiveTrackChanged], (event) => {
    if (typeof event.index === "number") setCurrentTrackIndex(event.index);
  });

  useEffect(() => {
    if (ready && isPlaying) callbacks.current.onPlay?.();
  }, [ready, isPlaying]);

  const publishSeek = useCallback(async () => {
    const session = getPlaybackSession(sessionKey);
    if (!session?.ready) return;
    await capturePlaybackPosition(session);
    const position = session.engine.getState().pending;
    if (position) callbacks.current.onPositionUpdate?.(position.chapterIndex, position.positionMs);
    void session.engine.onChapterChange();
  }, [sessionKey]);

  const seekTo = useCallback(async (ms: number) => {
    await seekPlaybackSession(indexRef.current, Math.max(0, ms));
    await publishSeek();
  }, [publishSeek]);

  const skipToChapter = useCallback(async (index: number, ms = 0) => {
    if (index < 0 || index >= chapters.length) return;
    await seekPlaybackSession(index, ms);
    await publishSeek();
  }, [chapters.length, publishSeek]);

  const play = useCallback(async () => {
    await TrackPlayer.play();
    void syncPlaybackState(State.Playing);
  }, []);
  const pause = useCallback(async () => {
    await TrackPlayer.pause();
    void syncPlaybackState(State.Paused);
  }, []);

  const state: MobilePlayerState = {
    isPlaying,
    currentChapterIndex: chapterIndex,
    positionMs: virtual ? Math.max(0, progress.position * 1000 - (chapters[chapterIndex]?.startMs ?? 0)) : progress.position * 1000,
    durationMs: virtual ? (chapters[chapterIndex]?.endMs ?? 0) - (chapters[chapterIndex]?.startMs ?? 0) : progress.duration * 1000,
    playbackSpeed: speed,
    isLoading: !error && (!ready || playbackState.state === State.Buffering || playbackState.state === State.Loading),
    error,
  };

  return [state, {
    play, pause, seekTo, skipToChapter,
    togglePlayPause: async () => {
      const playback = await TrackPlayer.getPlaybackState();
      if (playback.state === State.Playing) await pause(); else await play();
    },
    seekBy: async (deltaMs) => {
      const position = await TrackPlayer.getPosition();
      const chapter = chapters[indexRef.current];
      const offset = virtual ? chapter?.startMs ?? 0 : 0;
      const duration = virtual ? (chapter?.endMs ?? Infinity) - offset : Infinity;
      await seekTo(Math.min(duration, Math.max(0, position * 1000 - offset + deltaMs)));
    },
    nextChapter: async () => { await skipToChapter(indexRef.current + 1); },
    prevChapter: async () => { await skipToChapter(Math.max(0, indexRef.current - 1)); },
    setSpeed: async (value) => { await TrackPlayer.setRate(value); setSpeed(value); },
  }];
}
