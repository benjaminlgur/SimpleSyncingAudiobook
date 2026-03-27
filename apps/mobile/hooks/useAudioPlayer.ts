import { useState, useEffect, useCallback, useRef } from "react";
import TrackPlayer, {
  State,
  usePlaybackState,
  useProgress,
  useActiveTrack,
  Capability,
  AppKilledPlaybackBehavior,
} from "react-native-track-player";
import type { ChapterInfo } from "@audiobook/shared";

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

let isSetup = false;

async function setupPlayer() {
  if (isSetup) return;
  try {
    await TrackPlayer.setupPlayer({
      autoHandleInterruptions: true,
    });
    await TrackPlayer.updateOptions({
      android: {
        appKilledPlaybackBehavior:
          AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
      },
      capabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
        Capability.JumpForward,
        Capability.JumpBackward,
        Capability.SeekTo,
      ],
      compactCapabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
      ],
      forwardJumpInterval: 30,
      backwardJumpInterval: 30,
    });
    isSetup = true;
  } catch {
    isSetup = true;
  }
}

function isVirtualChapter(ch: ChapterInfo): boolean {
  return ch.startMs !== undefined && ch.endMs !== undefined;
}

interface UseAudioPlayerOptions {
  fileUris: string[];
  chapters: ChapterInfo[];
  initialChapterIndex?: number;
  initialPositionMs?: number;
  onPositionUpdate?: (chapterIndex: number, positionMs: number) => void;
  onChapterChange?: (chapterIndex: number) => void;
  onPause?: () => void;
  onPlay?: () => void;
}

export function useMobileAudioPlayer(
  options: UseAudioPlayerOptions
): [MobilePlayerState, MobilePlayerControls] {
  const {
    fileUris,
    chapters,
    initialChapterIndex = 0,
    initialPositionMs = 0,
    onPositionUpdate,
    onChapterChange,
    onPause,
    onPlay,
  } = options;

  const virtual = chapters.length > 0 && isVirtualChapter(chapters[0]);

  const [ready, setReady] = useState(false);
  const playbackState = usePlaybackState();
  const progress = useProgress(250);
  const activeTrack = useActiveTrack();
  const positionCallbackRef = useRef(onPositionUpdate);
  positionCallbackRef.current = onPositionUpdate;
  const chapterChangeRef = useRef(onChapterChange);
  chapterChangeRef.current = onChapterChange;

  const [speed, setSpeedState] = useState(1.0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [virtualChapterIdx, setVirtualChapterIdx] = useState(initialChapterIndex);
  const virtualIdxRef = useRef(virtualChapterIdx);
  virtualIdxRef.current = virtualChapterIdx;

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await setupPlayer();
        await TrackPlayer.reset();

        if (virtual) {
          const track = {
            id: "m4b-single",
            url: fileUris[0],
            title: chapters[0]?.title || "Audiobook",
            artist: "Audiobook",
          };
          await TrackPlayer.add([track]);

          const ch = chapters[initialChapterIndex];
          const absoluteMs = (ch?.startMs || 0) + initialPositionMs;
          await TrackPlayer.seekTo(absoluteMs / 1000);
        } else {
          const tracks = fileUris.map((uri, i) => ({
            id: `chapter-${i}`,
            url: uri,
            title:
              chapters[i]?.title ||
              chapters[i]?.filename?.replace(/\.[^/.]+$/, "") ||
              `Chapter ${i + 1}`,
            artist: "Audiobook",
          }));
          await TrackPlayer.add(tracks);

          if (initialChapterIndex > 0) {
            await TrackPlayer.skip(initialChapterIndex);
          }
          if (initialPositionMs > 0) {
            await TrackPlayer.seekTo(initialPositionMs / 1000);
          }
        }

        if (mounted) setReady(true);
      } catch (err) {
        if (mounted) {
          const msg = err instanceof Error ? err.message : "Failed to load audio files";
          setLoadError(msg);
          setReady(true);
        }
      }
    })();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Position update + virtual chapter boundary detection
  useEffect(() => {
    if (!ready) return;

    if (virtual) {
      const absoluteMs = progress.position * 1000;
      const ch = chapters[virtualIdxRef.current];
      if (!ch) return;

      const posMs = Math.max(0, absoluteMs - (ch.startMs || 0));

      if (absoluteMs >= (ch.endMs || Infinity)) {
        const nextIdx = virtualIdxRef.current + 1;
        if (nextIdx < chapters.length) {
          setVirtualChapterIdx(nextIdx);
          virtualIdxRef.current = nextIdx;
          chapterChangeRef.current?.(nextIdx);
          const nextCh = chapters[nextIdx];
          TrackPlayer.seekTo((nextCh.startMs || 0) / 1000);
        } else {
          TrackPlayer.pause();
        }
        return;
      }

      positionCallbackRef.current?.(virtualIdxRef.current, posMs);
    } else {
      const currentIndex = activeTrack
        ? parseInt(activeTrack.id?.replace("chapter-", "") || "0")
        : 0;
      positionCallbackRef.current?.(currentIndex, progress.position * 1000);
    }
  }, [progress.position, activeTrack, ready, virtual, chapters]);

  const currentChapterIndex = virtual
    ? virtualChapterIdx
    : activeTrack
      ? parseInt(activeTrack.id?.replace("chapter-", "") || "0")
      : 0;

  const isPlaying =
    playbackState.state === State.Playing ||
    playbackState.state === State.Buffering;

  let positionMs: number;
  let durationMs: number;
  if (virtual) {
    const ch = chapters[virtualChapterIdx];
    const absoluteMs = progress.position * 1000;
    positionMs = ch ? Math.max(0, absoluteMs - (ch.startMs || 0)) : 0;
    durationMs = ch ? (ch.endMs || 0) - (ch.startMs || 0) : 0;
  } else {
    positionMs = progress.position * 1000;
    durationMs = progress.duration * 1000;
  }

  const playbackError = playbackState.state === State.Error
    ? "Playback error — audio files may be unavailable"
    : null;

  const state: MobilePlayerState = {
    isPlaying,
    currentChapterIndex,
    positionMs,
    durationMs,
    playbackSpeed: speed,
    isLoading: !ready || playbackState.state === State.Buffering,
    error: loadError || playbackError,
  };

  const controls: MobilePlayerControls = {
    play: useCallback(async () => {
      await TrackPlayer.play();
      onPlay?.();
    }, [onPlay]),

    pause: useCallback(async () => {
      await TrackPlayer.pause();
      onPause?.();
    }, [onPause]),

    togglePlayPause: useCallback(async () => {
      const st = await TrackPlayer.getPlaybackState();
      if (st.state === State.Playing) {
        await TrackPlayer.pause();
        onPause?.();
      } else {
        await TrackPlayer.play();
        onPlay?.();
      }
    }, [onPause, onPlay]),

    seekTo: useCallback(async (ms: number) => {
      if (virtual) {
        const ch = chapters[virtualIdxRef.current];
        if (ch) {
          await TrackPlayer.seekTo(((ch.startMs || 0) + ms) / 1000);
        }
      } else {
        await TrackPlayer.seekTo(ms / 1000);
      }
    }, [virtual, chapters]),

    seekBy: useCallback(async (deltaMs: number) => {
      const pos = await TrackPlayer.getPosition();
      if (virtual) {
        const ch = chapters[virtualIdxRef.current];
        if (ch) {
          const newMs = Math.max(
            ch.startMs || 0,
            Math.min(ch.endMs || Infinity, pos * 1000 + deltaMs)
          );
          await TrackPlayer.seekTo(newMs / 1000);
        }
      } else {
        await TrackPlayer.seekTo(Math.max(0, pos + deltaMs / 1000));
      }
    }, [virtual, chapters]),

    skipToChapter: useCallback(
      async (index: number, seekMs?: number) => {
        if (virtual) {
          const ch = chapters[index];
          if (ch) {
            setVirtualChapterIdx(index);
            virtualIdxRef.current = index;
            const absoluteMs = (ch.startMs || 0) + (seekMs || 0);
            await TrackPlayer.seekTo(absoluteMs / 1000);
            onChapterChange?.(index);
          }
        } else {
          await TrackPlayer.skip(index);
          if (seekMs && seekMs > 0) {
            await TrackPlayer.seekTo(seekMs / 1000);
          }
          onChapterChange?.(index);
        }
      },
      [virtual, chapters, onChapterChange]
    ),

    nextChapter: useCallback(async () => {
      if (virtual) {
        const nextIdx = virtualIdxRef.current + 1;
        if (nextIdx < chapters.length) {
          setVirtualChapterIdx(nextIdx);
          virtualIdxRef.current = nextIdx;
          const ch = chapters[nextIdx];
          await TrackPlayer.seekTo((ch.startMs || 0) / 1000);
          onChapterChange?.(nextIdx);
        }
      } else {
        try {
          await TrackPlayer.skipToNext();
          const track = await TrackPlayer.getActiveTrack();
          if (track) {
            const idx = parseInt(track.id?.replace("chapter-", "") || "0");
            onChapterChange?.(idx);
          }
        } catch {
          // No next track
        }
      }
    }, [virtual, chapters, onChapterChange]),

    prevChapter: useCallback(async () => {
      if (virtual) {
        const prevIdx = virtualIdxRef.current - 1;
        if (prevIdx >= 0) {
          setVirtualChapterIdx(prevIdx);
          virtualIdxRef.current = prevIdx;
          const ch = chapters[prevIdx];
          await TrackPlayer.seekTo((ch.startMs || 0) / 1000);
          onChapterChange?.(prevIdx);
        }
      } else {
        try {
          await TrackPlayer.skipToPrevious();
          const track = await TrackPlayer.getActiveTrack();
          if (track) {
            const idx = parseInt(track.id?.replace("chapter-", "") || "0");
            onChapterChange?.(idx);
          }
        } catch {
          // No previous track
        }
      }
    }, [virtual, chapters, onChapterChange]),

    setSpeed: useCallback(async (s: number) => {
      await TrackPlayer.setRate(s);
      setSpeedState(s);
    }, []),
  };

  return [state, controls];
}
