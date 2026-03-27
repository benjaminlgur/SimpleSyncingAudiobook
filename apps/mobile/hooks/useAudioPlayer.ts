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
}

export interface MobilePlayerControls {
  play: () => Promise<void>;
  pause: () => Promise<void>;
  togglePlayPause: () => Promise<void>;
  seekTo: (ms: number) => Promise<void>;
  seekBy: (deltaMs: number) => Promise<void>;
  skipToChapter: (index: number) => Promise<void>;
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
    // Already setup
    isSetup = true;
  }
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

  const [ready, setReady] = useState(false);
  const playbackState = usePlaybackState();
  const progress = useProgress(1000);
  const activeTrack = useActiveTrack();
  const positionCallbackRef = useRef(onPositionUpdate);
  positionCallbackRef.current = onPositionUpdate;

  const [speed, setSpeedState] = useState(1.0);

  useEffect(() => {
    let mounted = true;
    (async () => {
      await setupPlayer();
      await TrackPlayer.reset();

      const tracks = fileUris.map((uri, i) => ({
        id: `chapter-${i}`,
        url: uri,
        title:
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

      if (mounted) setReady(true);
    })();

    return () => {
      mounted = false;
    };
    // Only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Position update callback
  useEffect(() => {
    if (!ready) return;
    const currentIndex = activeTrack
      ? parseInt(activeTrack.id?.replace("chapter-", "") || "0")
      : 0;
    positionCallbackRef.current?.(currentIndex, progress.position * 1000);
  }, [progress.position, activeTrack, ready]);

  const currentChapterIndex = activeTrack
    ? parseInt(activeTrack.id?.replace("chapter-", "") || "0")
    : 0;

  const isPlaying =
    playbackState.state === State.Playing ||
    playbackState.state === State.Buffering;

  const state: MobilePlayerState = {
    isPlaying,
    currentChapterIndex,
    positionMs: progress.position * 1000,
    durationMs: progress.duration * 1000,
    playbackSpeed: speed,
    isLoading: !ready || playbackState.state === State.Buffering,
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
      const state = await TrackPlayer.getPlaybackState();
      if (state.state === State.Playing) {
        await TrackPlayer.pause();
        onPause?.();
      } else {
        await TrackPlayer.play();
        onPlay?.();
      }
    }, [onPause, onPlay]),

    seekTo: useCallback(async (ms: number) => {
      await TrackPlayer.seekTo(ms / 1000);
    }, []),

    seekBy: useCallback(async (deltaMs: number) => {
      const pos = await TrackPlayer.getPosition();
      await TrackPlayer.seekTo(Math.max(0, pos + deltaMs / 1000));
    }, []),

    skipToChapter: useCallback(
      async (index: number) => {
        await TrackPlayer.skip(index);
        onChapterChange?.(index);
      },
      [onChapterChange]
    ),

    nextChapter: useCallback(async () => {
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
    }, [onChapterChange]),

    prevChapter: useCallback(async () => {
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
    }, [onChapterChange]),

    setSpeed: useCallback(async (s: number) => {
      await TrackPlayer.setRate(s);
      setSpeedState(s);
    }, []),
  };

  return [state, controls];
}
