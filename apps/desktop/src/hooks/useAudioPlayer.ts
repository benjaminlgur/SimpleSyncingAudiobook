import { useState, useRef, useCallback, useEffect } from "react";
import type { ChapterInfo } from "@audiobook/shared";
import { loadAudioFileAsBlob, revokeCurrentAudioBlob, FileNotFoundError } from "../lib/tauri-fs";

export interface AudioPlayerState {
  isPlaying: boolean;
  currentChapterIndex: number;
  positionMs: number;
  durationMs: number;
  playbackSpeed: number;
  isLoading: boolean;
  error: string | null;
  fileNotFound: boolean;
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

function isVirtualChapter(ch: ChapterInfo): boolean {
  return ch.startMs !== undefined && ch.endMs !== undefined;
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
  const loadedFileRef = useRef<string | null>(null);

  const [state, setState] = useState<AudioPlayerState>({
    isPlaying: false,
    currentChapterIndex: initialChapterIndex,
    positionMs: initialPositionMs,
    durationMs: 0,
    playbackSpeed: 1.0,
    isLoading: true,
    error: null,
    fileNotFound: false,
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
    async (index: number, seekMs = 0, forcePlay = false) => {
      if (index < 0 || index >= chapters.length) return;

      const chapter = chapters[index];
      const virtual = isVirtualChapter(chapter);

      setState((s) => ({
        ...s,
        isLoading: true,
        currentChapterIndex: index,
        error: null,
      }));

      const audio = getOrCreateAudio();
      const shouldPlayAfterLoad = forcePlay || !audio.paused;

      const sameFile = loadedFileRef.current === chapter.filename && audio.src;

      if (!sameFile) {
        audio.pause();
        try {
          const blobUrl = await loadAudioFileAsBlob(folderPath, chapter.filename);
          audio.src = blobUrl;
          audio.playbackRate = stateRef.current.playbackSpeed;
          loadedFileRef.current = chapter.filename;

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
        const notFound = err instanceof FileNotFoundError;
        const msg = notFound
          ? "Audiobook files not found — folder may have been moved or deleted"
          : err instanceof Error ? err.message : "Failed to load audio";
        console.error("loadChapter failed:", msg);
        setState((s) => ({ ...s, isLoading: false, error: msg, fileNotFound: notFound }));
        loadedFileRef.current = null;
        return;
      }
      }

      if (virtual) {
        audio.currentTime = (chapter.startMs! + seekMs) / 1000;
        const chapterDuration = chapter.endMs! - chapter.startMs!;
        setState((s) => ({
          ...s,
          isLoading: false,
          durationMs: chapterDuration,
          positionMs: seekMs,
          currentChapterIndex: index,
        }));
      } else {
        audio.currentTime = seekMs / 1000;
        setState((s) => ({
          ...s,
          isLoading: false,
          durationMs: (audio.duration || 0) * 1000,
          positionMs: seekMs,
          currentChapterIndex: index,
        }));
      }

      if (shouldPlayAfterLoad) {
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

  // Auto-advance: for non-virtual chapters use the "ended" event,
  // for virtual chapters use the position timer below.
  useEffect(() => {
    const ch0 = chapters[0];
    if (ch0 && isVirtualChapter(ch0)) return;

    const audio = getOrCreateAudio();
    const handleEnded = () => {
      const nextIndex = stateRef.current.currentChapterIndex + 1;
      if (nextIndex < chapters.length) {
        loadChapter(nextIndex, 0, true);
        onChapterChange?.(nextIndex);
      } else {
        setState((s) => ({ ...s, isPlaying: false }));
      }
    };
    audio.addEventListener("ended", handleEnded);
    return () => audio.removeEventListener("ended", handleEnded);
  }, [chapters, getOrCreateAudio, loadChapter, onChapterChange]);

  // Position tracking timer (handles both modes + virtual chapter auto-advance)
  useEffect(() => {
    positionTimerRef.current = setInterval(() => {
      const audio = audioRef.current;
      if (!audio || audio.paused) return;

      const idx = stateRef.current.currentChapterIndex;
      const chapter = chapters[idx];
      if (!chapter) return;

      if (isVirtualChapter(chapter)) {
        const absoluteMs = audio.currentTime * 1000;
        const posMs = Math.max(0, absoluteMs - chapter.startMs!);

        if (absoluteMs >= chapter.endMs!) {
          const nextIndex = idx + 1;
          if (nextIndex < chapters.length) {
            loadChapter(nextIndex, 0);
            onChapterChange?.(nextIndex);
          } else {
            audio.pause();
            setState((s) => ({ ...s, isPlaying: false }));
          }
          return;
        }

        setState((s) => ({ ...s, positionMs: posMs }));
        onPositionUpdate?.(idx, posMs);
      } else {
        const posMs = audio.currentTime * 1000;
        setState((s) => ({ ...s, positionMs: posMs }));
        onPositionUpdate?.(idx, posMs);
      }
    }, 250);

    return () => {
      if (positionTimerRef.current) clearInterval(positionTimerRef.current);
    };
  }, [chapters, onPositionUpdate, loadChapter, onChapterChange]);

  // Load initial chapter
  useEffect(() => {
    loadChapter(initialChapterIndex, initialPositionMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
      loadedFileRef.current = null;
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
      const chapter = chapters[stateRef.current.currentChapterIndex];
      if (chapter && isVirtualChapter(chapter)) {
        const absoluteMs = chapter.startMs! + ms;
        audio.currentTime = absoluteMs / 1000;
        setState((s) => ({ ...s, positionMs: ms }));
      } else {
        audio.currentTime = ms / 1000;
        setState((s) => ({ ...s, positionMs: ms }));
      }
    }, [chapters]),

    seekBy: useCallback((deltaMs: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      const chapter = chapters[stateRef.current.currentChapterIndex];

      if (chapter && isVirtualChapter(chapter)) {
        const absoluteMs = audio.currentTime * 1000;
        const newAbsoluteMs = Math.max(
          chapter.startMs!,
          Math.min(chapter.endMs!, absoluteMs + deltaMs)
        );
        audio.currentTime = newAbsoluteMs / 1000;
        setState((s) => ({ ...s, positionMs: newAbsoluteMs - chapter.startMs! }));
      } else {
        const newTime = Math.max(
          0,
          Math.min(audio.duration, audio.currentTime + deltaMs / 1000)
        );
        audio.currentTime = newTime;
        setState((s) => ({ ...s, positionMs: newTime * 1000 }));
      }
    }, [chapters]),

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
      } else if (stateRef.current.currentChapterIndex === 0) {
        loadChapter(0, 0);
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
