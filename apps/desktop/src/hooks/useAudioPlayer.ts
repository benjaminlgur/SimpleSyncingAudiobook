import { useState, useRef, useCallback, useEffect } from "react";
import type { ChapterInfo } from "@audiobook/shared";
import { loadAudioFileAsBlob, revokeCurrentAudioBlob } from "../lib/tauri-fs";

export interface AudioPlayerState {
  isPlaying: boolean;
  currentChapterIndex: number;
  positionMs: number;
  durationMs: number;
  playbackSpeed: number;
  isLoading: boolean;
  error: string | null;
}

export interface AudioPlayerControls {
  play: () => void;
  pause: () => void;
  togglePlayPause: () => void;
  seekTo: (ms: number) => void;
  seekBy: (deltaMs: number) => void;
  skipToChapter: (index: number, seekMs?: number) => void;
  nextChapter: () => void;
  prevChapter: () => void;
  setSpeed: (speed: number) => void;
}

interface UseAudioPlayerOptions {
  folderPath: string;
  chapters: ChapterInfo[];
  initialChapterIndex?: number;
  initialPositionMs?: number;
  onPositionUpdate?: (chapterIndex: number, positionMs: number) => void;
  onChapterChange?: (chapterIndex: number) => void;
  onPause?: () => void;
  onPlay?: () => void;
}

export function useAudioPlayer(
  options: UseAudioPlayerOptions
): [AudioPlayerState, AudioPlayerControls] {
  const {
    folderPath,
    chapters,
    initialChapterIndex = 0,
    initialPositionMs = 0,
    onPositionUpdate,
    onChapterChange,
    onPause,
    onPlay,
  } = options;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const positionTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [state, setState] = useState<AudioPlayerState>({
    isPlaying: false,
    currentChapterIndex: initialChapterIndex,
    positionMs: initialPositionMs,
    durationMs: 0,
    playbackSpeed: 1.0,
    isLoading: true,
    error: null,
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const getOrCreateAudio = useCallback((): HTMLAudioElement => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
    }
    return audioRef.current;
  }, []);

  const loadChapter = useCallback(
    async (index: number, seekMs = 0) => {
      if (index < 0 || index >= chapters.length) return;

      setState((s) => ({
        ...s,
        isLoading: true,
        currentChapterIndex: index,
        error: null,
      }));

      const audio = getOrCreateAudio();
      const wasPlaying = !audio.paused;
      audio.pause();

      try {
        const blobUrl = await loadAudioFileAsBlob(
          folderPath,
          chapters[index].filename
        );
        audio.src = blobUrl;
        audio.playbackRate = stateRef.current.playbackSpeed;

        await new Promise<void>((resolve, reject) => {
          const onLoaded = () => {
            cleanup();
            resolve();
          };
          const onError = () => {
            cleanup();
            reject(
              new Error(
                audio.error?.message || "Audio element failed to decode file"
              )
            );
          };
          const cleanup = () => {
            audio.removeEventListener("loadedmetadata", onLoaded);
            audio.removeEventListener("error", onError);
          };
          audio.addEventListener("loadedmetadata", onLoaded);
          audio.addEventListener("error", onError);
          audio.load();
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to load audio";
        console.error("loadChapter failed:", msg);
        setState((s) => ({ ...s, isLoading: false, error: msg }));
        return;
      }

      audio.currentTime = seekMs / 1000;
      setState((s) => ({
        ...s,
        isLoading: false,
        durationMs: (audio.duration || 0) * 1000,
        positionMs: seekMs,
        currentChapterIndex: index,
      }));

      if (wasPlaying) {
        try {
          await audio.play();
          setState((s) => ({ ...s, isPlaying: true }));
        } catch (err) {
          console.error("Auto-resume play failed:", err);
        }
      }
    },
    [chapters, folderPath, getOrCreateAudio]
  );

  // Set up ended listener for auto-advance
  useEffect(() => {
    const audio = getOrCreateAudio();
    const handleEnded = () => {
      const nextIndex = stateRef.current.currentChapterIndex + 1;
      if (nextIndex < chapters.length) {
        loadChapter(nextIndex, 0);
        onChapterChange?.(nextIndex);
      } else {
        setState((s) => ({ ...s, isPlaying: false }));
      }
    };
    audio.addEventListener("ended", handleEnded);
    return () => audio.removeEventListener("ended", handleEnded);
  }, [chapters.length, getOrCreateAudio, loadChapter, onChapterChange]);

  // Position tracking timer
  useEffect(() => {
    positionTimerRef.current = setInterval(() => {
      const audio = audioRef.current;
      if (!audio || audio.paused) return;
      const posMs = audio.currentTime * 1000;
      setState((s) => ({ ...s, positionMs: posMs }));
      onPositionUpdate?.(stateRef.current.currentChapterIndex, posMs);
    }, 1000);

    return () => {
      if (positionTimerRef.current) clearInterval(positionTimerRef.current);
    };
  }, [onPositionUpdate]);

  // Load initial chapter
  useEffect(() => {
    loadChapter(initialChapterIndex, initialPositionMs);
    // Only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
      revokeCurrentAudioBlob();
    };
  }, []);

  const controls: AudioPlayerControls = {
    play: useCallback(() => {
      audioRef.current?.play();
      setState((s) => ({ ...s, isPlaying: true }));
      onPlay?.();
    }, [onPlay]),

    pause: useCallback(() => {
      audioRef.current?.pause();
      setState((s) => ({ ...s, isPlaying: false }));
      onPause?.();
    }, [onPause]),

    togglePlayPause: useCallback(() => {
      if (audioRef.current?.paused) {
        audioRef.current.play();
        setState((s) => ({ ...s, isPlaying: true }));
        onPlay?.();
      } else {
        audioRef.current?.pause();
        setState((s) => ({ ...s, isPlaying: false }));
        onPause?.();
      }
    }, [onPause, onPlay]),

    seekTo: useCallback((ms: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.currentTime = ms / 1000;
      setState((s) => ({ ...s, positionMs: ms }));
    }, []),

    seekBy: useCallback((deltaMs: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      const newTime = Math.max(
        0,
        Math.min(audio.duration, audio.currentTime + deltaMs / 1000)
      );
      audio.currentTime = newTime;
      setState((s) => ({ ...s, positionMs: newTime * 1000 }));
    }, []),

    skipToChapter: useCallback(
      (index: number, seekMs?: number) => {
        loadChapter(index, seekMs ?? 0);
        onChapterChange?.(index);
      },
      [loadChapter, onChapterChange]
    ),

    nextChapter: useCallback(() => {
      const nextIdx = stateRef.current.currentChapterIndex + 1;
      if (nextIdx < chapters.length) {
        loadChapter(nextIdx, 0);
        onChapterChange?.(nextIdx);
      }
    }, [chapters.length, loadChapter, onChapterChange]),

    prevChapter: useCallback(() => {
      const prevIdx = stateRef.current.currentChapterIndex - 1;
      if (prevIdx >= 0) {
        loadChapter(prevIdx, 0);
        onChapterChange?.(prevIdx);
      }
    }, [loadChapter, onChapterChange]),

    setSpeed: useCallback((speed: number) => {
      if (audioRef.current) {
        audioRef.current.playbackRate = speed;
      }
      setState((s) => ({ ...s, playbackSpeed: speed }));
    }, []),
  };

  return [state, controls];
}
