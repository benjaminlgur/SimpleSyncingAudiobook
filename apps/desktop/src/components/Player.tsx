import { useState, useEffect, useCallback, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useAudioPlayer } from "../hooks/useAudioPlayer";
import { SyncEngine } from "@audiobook/shared";
import type { SyncState, SyncPushResult } from "@audiobook/shared";
import type { LocalAudiobook } from "./AppShell";
import { formatTime, formatTimeRemaining } from "../lib/utils";
import { extractCoverArt, pickAudiobookFolder, pickAudiobookFile, checkPathExists } from "../lib/tauri-fs";
import { SyncIndicator } from "./SyncIndicator";
import { ChaptersDrawer } from "./ChaptersDrawer";
import type { Id } from "../../../../convex/_generated/dataModel";

interface PlayerProps {
  book: LocalAudiobook;
  convexUrl: string;
  onBack: () => void;
  onConvexIdResolved: (id: string) => void;
  onRelocate: (newFolderPath: string) => void;
}

const localStorageAdapter = {
  getItem: async (key: string) => localStorage.getItem(key),
  setItem: async (key: string, value: string) =>
    localStorage.setItem(key, value),
  removeItem: async (key: string) => localStorage.removeItem(key),
};

const SPEEDS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
const REMOTE_POSITION_PROMPT_DELAY_MS = 12_000;

export function Player({
  book,
  convexUrl,
  onBack,
  onConvexIdResolved,
  onRelocate,
}: PlayerProps) {
  const [syncState, setSyncState] = useState<SyncState>({
    status: "idle",
    pending: null,
    lastSyncedAt: null,
    lastError: null,
  });
  const [showChapters, setShowChapters] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [initialChapter, setInitialChapter] = useState(0);
  const [initialPosition, setInitialPosition] = useState(0);
  const [localInitResolved, setLocalInitResolved] = useState(false);
  const [showOfflinePrompt, setShowOfflinePrompt] = useState(false);
  const [networkStatus, setNetworkStatus] = useState<
    "unknown" | "online" | "offline"
  >("unknown");

  const syncEngineRef = useRef<SyncEngine | null>(null);
  const initialLoadedRef = useRef(false);
  const usedFallbackStartupRef = useRef(false);
  const playbackProgressedRef = useRef(false);
  const lateRemoteAppliedRef = useRef(false);
  const updatePosition = useMutation(api.positions.update);
  const getOrCreate = useMutation(api.audiobooks.getOrCreate);

  useEffect(() => {
    initialLoadedRef.current = initialLoaded;
  }, [initialLoaded]);

  useEffect(() => {
    const updateStatus = () => {
      setNetworkStatus(window.navigator.onLine ? "online" : "offline");
    };

    updateStatus();
    window.addEventListener("online", updateStatus);
    window.addEventListener("offline", updateStatus);

    return () => {
      window.removeEventListener("online", updateStatus);
      window.removeEventListener("offline", updateStatus);
    };
  }, []);

  const convexId = book.convexId;
  const syncStorageKey = convexId || `local_${book.name}_${book.checksum}`;
  const remotePosition = useQuery(
    api.positions.get,
    convexId ? { audiobookId: convexId as Id<"audiobooks"> } : "skip"
  );

  // Resolve Convex ID on mount if needed
  useEffect(() => {
    if (convexId) return;
    (async () => {
      try {
        const result = await getOrCreate({
          name: book.name,
          checksum: book.checksum,
          chapters: book.chapters,
        });
        onConvexIdResolved(result.audiobookId);
      } catch {
        // Will retry on next sync
      }
    })();
  }, [convexId, book, getOrCreate, onConvexIdResolved]);

  // Prefer remote position when it arrives — dismiss offline prompt if showing.
  useEffect(() => {
    if (initialLoaded) return;
    if (remotePosition === undefined) return;

    if (remotePosition) {
      setInitialChapter(remotePosition.chapterIndex);
      setInitialPosition(remotePosition.positionMs);
    }
    usedFallbackStartupRef.current = false;
    setShowOfflinePrompt(false);
    setInitialLoaded(true);
  }, [remotePosition, initialLoaded]);

  // If local state is ready first, only show the warning immediately when
  // the desktop is offline. Otherwise keep waiting for the remote sync.
  useEffect(() => {
    if (initialLoaded || !localInitResolved) return;
    if (remotePosition !== undefined) return;

    if (convexId) {
      if (networkStatus === "offline") {
        setShowOfflinePrompt(true);
      }
    } else {
      setInitialLoaded(true);
    }
  }, [convexId, initialLoaded, localInitResolved, networkStatus, remotePosition]);

  // If remote sync stays unresolved for a while even while online, then
  // let the user decide whether to continue from local state.
  useEffect(() => {
    if (initialLoaded || showOfflinePrompt) return;
    if (!convexId || remotePosition !== undefined || !localInitResolved) return;

    const timeoutId = setTimeout(() => {
      if (initialLoadedRef.current) return;
      setShowOfflinePrompt(true);
    }, REMOTE_POSITION_PROMPT_DELAY_MS);

    return () => clearTimeout(timeoutId);
  }, [initialLoaded, showOfflinePrompt, localInitResolved, remotePosition, convexId]);

  const handleContinueOffline = useCallback(() => {
    usedFallbackStartupRef.current = true;
    setShowOfflinePrompt(false);
    setInitialLoaded(true);
  }, []);

  const seekToRef = useRef<((chapter: number, ms: number) => void) | null>(null);

  // If we started from fallback state, adopt remote position once
  // if playback has not progressed yet.
  useEffect(() => {
    if (!initialLoaded || !remotePosition) return;
    if (!usedFallbackStartupRef.current) return;
    if (lateRemoteAppliedRef.current || playbackProgressedRef.current) return;

    lateRemoteAppliedRef.current = true;
    setInitialChapter(remotePosition.chapterIndex);
    setInitialPosition(remotePosition.positionMs);
    seekToRef.current?.(remotePosition.chapterIndex, remotePosition.positionMs);
  }, [initialLoaded, remotePosition]);

  // Initialize sync engine — works with or without a Convex ID.
  useEffect(() => {
    let cancelled = false;

    const pushFn = async (position: {
      audiobookId: string;
      chapterIndex: number;
      positionMs: number;
      updatedAt: number;
    }): Promise<SyncPushResult> => {
      if (!convexId) throw new Error("No Convex ID yet");
      const result = await updatePosition({
        audiobookId: position.audiobookId as Id<"audiobooks">,
        chapterIndex: position.chapterIndex,
        positionMs: position.positionMs,
        clientUpdatedAt: position.updatedAt,
      });
      return {
        accepted: result.accepted,
        serverPosition: result.serverPosition,
      };
    };

    const onRemoteNewer = (remote: {
      chapterIndex: number;
      positionMs: number;
    }) => {
      seekToRef.current?.(remote.chapterIndex, remote.positionMs);
    };

    const engine = new SyncEngine(
      syncStorageKey,
      localStorageAdapter,
      pushFn,
      onRemoteNewer,
    );
    syncEngineRef.current = engine;

    const unsub = engine.subscribe(setSyncState);

    (async () => {
      try {
        const localPos = await engine.initialize();
        if (cancelled) return;
        if (localPos && !initialLoadedRef.current) {
          setInitialChapter(localPos.chapterIndex);
          setInitialPosition(localPos.positionMs);
        }
      } finally {
        if (!cancelled) {
          setLocalInitResolved(true);
        }
      }
    })();

    return () => {
      cancelled = true;
      unsub();
      engine.destroy();
      syncEngineRef.current = null;
    };
  }, [convexId, updatePosition, book.name, book.checksum, syncStorageKey]);

  const handlePositionUpdate = useCallback(
    (chapterIndex: number, positionMs: number) => {
      if (chapterIndex > 0 || positionMs > 0) {
        playbackProgressedRef.current = true;
      }
      syncEngineRef.current?.updatePosition(chapterIndex, positionMs);
    },
    []
  );

  const handleChapterChange = useCallback(() => {
    playbackProgressedRef.current = true;
    syncEngineRef.current?.onChapterChange();
  }, []);

  const handlePause = useCallback(() => {
    syncEngineRef.current?.onPause();
  }, []);

  const handlePlay = useCallback(() => {
    playbackProgressedRef.current = true;
    syncEngineRef.current?.onPlay();
  }, []);

  if (!initialLoaded) {
    if (showOfflinePrompt) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="max-w-sm text-center space-y-4 px-6">
            <svg
              className="mx-auto h-12 w-12 text-primary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
              />
            </svg>
            <h2 className="text-lg font-semibold text-foreground">
              Unable to Sync
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              The latest position for &ldquo;{book.name}&rdquo; couldn&rsquo;t
              be loaded from the server. Continuing with your local position may
              cause sync conflicts if you&rsquo;ve listened on another device.
            </p>
            <div className="flex flex-col gap-2 pt-2">
              <button
                onClick={handleContinueOffline}
                className="w-full px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                Continue with Local Position
              </button>
              <button
                onClick={onBack}
                className="w-full px-4 py-2.5 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Go Back
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground text-sm">
          Loading position...
        </div>
      </div>
    );
  }

  return (
    <PlayerInner
      book={book}
      initialChapter={initialChapter}
      initialPosition={initialPosition}
      syncState={syncState}
      showChapters={showChapters}
      showSpeedMenu={showSpeedMenu}
      onToggleChapters={() => setShowChapters(!showChapters)}
      onToggleSpeedMenu={() => setShowSpeedMenu(!showSpeedMenu)}
      onBack={onBack}
      onPositionUpdate={handlePositionUpdate}
      onChapterChange={handleChapterChange}
      onPause={handlePause}
      onPlay={handlePlay}
      onManualSync={() => syncEngineRef.current?.manualSync()}
      onRelocate={onRelocate}
      seekToRef={seekToRef}
    />
  );
}

interface PlayerInnerProps {
  book: LocalAudiobook;
  initialChapter: number;
  initialPosition: number;
  syncState: SyncState;
  showChapters: boolean;
  showSpeedMenu: boolean;
  onToggleChapters: () => void;
  onToggleSpeedMenu: () => void;
  onBack: () => void;
  onPositionUpdate: (chapterIndex: number, positionMs: number) => void;
  onChapterChange: (chapterIndex: number) => void;
  onPause: () => void;
  onPlay: () => void;
  onManualSync: () => void;
  onRelocate: (newFolderPath: string) => void;
  seekToRef: React.MutableRefObject<((chapter: number, ms: number) => void) | null>;
}

function SeekBar({
  progressPercent,
  durationMs,
  onSeek,
}: {
  progressPercent: number;
  durationMs: number;
  onSeek: (ms: number) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [dragPercent, setDragPercent] = useState<number | null>(null);

  const percentFromEvent = useCallback(
    (e: MouseEvent | React.MouseEvent) => {
      const rect = barRef.current?.getBoundingClientRect();
      if (!rect) return 0;
      return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    },
    []
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      setDragPercent(percentFromEvent(e) * 100);
    };
    const onUp = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      const pct = percentFromEvent(e);
      setDragPercent(null);
      onSeek(pct * durationMs);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [durationMs, onSeek, percentFromEvent]);

  const displayPercent = dragPercent ?? progressPercent;

  return (
    <div
      ref={barRef}
      className="relative h-4 flex items-center cursor-pointer group"
      onMouseDown={(e) => {
        draggingRef.current = true;
        const pct = percentFromEvent(e);
        setDragPercent(pct * 100);
      }}
      onClick={(e) => {
        if (dragPercent !== null) return;
        const pct = percentFromEvent(e);
        onSeek(pct * durationMs);
      }}
    >
      <div className="absolute inset-x-0 h-1.5 bg-secondary rounded-full">
        <div
          className="absolute inset-y-0 left-0 bg-primary rounded-full"
          style={{ width: `${displayPercent}%` }}
        />
      </div>
      <div
        className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-primary rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
        style={{
          left: `calc(${displayPercent}% - 7px)`,
          opacity: draggingRef.current ? 1 : undefined,
        }}
      />
    </div>
  );
}

function PlayerInner({
  book,
  initialChapter,
  initialPosition,
  syncState,
  showChapters,
  showSpeedMenu,
  onToggleChapters,
  onToggleSpeedMenu,
  onBack,
  onPositionUpdate,
  onChapterChange,
  onPause,
  onPlay,
  onManualSync,
  onRelocate,
  seekToRef,
}: PlayerInnerProps) {
  const [coverArtUrl, setCoverArtUrl] = useState<string | null>(null);

  const handleRelocateFromPlayer = async () => {
    const isM4b = book.chapters.length > 0 &&
      book.chapters[0].filename === book.chapters[book.chapters.length - 1].filename;

    let newPath: string | null;
    if (isM4b) {
      newPath = await pickAudiobookFile();
      if (newPath) {
        const sepIdx = Math.max(newPath.lastIndexOf("/"), newPath.lastIndexOf("\\"));
        newPath = sepIdx > 0 ? newPath.substring(0, sepIdx) : newPath;
      }
    } else {
      newPath = await pickAudiobookFolder();
    }

    if (!newPath) return;

    const firstFile = book.chapters[0]?.filename;
    if (firstFile) {
      const sep = newPath.includes("\\") ? "\\" : "/";
      const testPath = `${newPath}${sep}${firstFile}`;
      const found = await checkPathExists(testPath);
      if (!found) {
        alert(`Could not find "${firstFile}" in the selected location. Please choose the correct folder.`);
        return;
      }
    }

    onRelocate(newPath);
  };

  useEffect(() => {
    let cancelled = false;
    extractCoverArt(book.folderPath, book.chapters).then((url) => {
      if (!cancelled) setCoverArtUrl(url);
    });
    return () => { cancelled = true; };
  }, [book.folderPath, book.chapters]);

  const [playerState, controls] = useAudioPlayer({
    folderPath: book.folderPath,
    chapters: book.chapters,
    initialChapterIndex: initialChapter,
    initialPositionMs: initialPosition,
    onPositionUpdate,
    onChapterChange,
    onPause,
    onPlay,
  });

  useEffect(() => {
    seekToRef.current = (chapter: number, ms: number) => {
      controls.skipToChapter(chapter, ms);
    };
    return () => { seekToRef.current = null; };
  }, [controls, seekToRef]);

  const currentChapter = book.chapters[playerState.currentChapterIndex];
  const chapterLabel =
    currentChapter?.title ||
    currentChapter?.filename?.replace(/\.[^/.]+$/, "") ||
    `Chapter ${playerState.currentChapterIndex + 1}`;

  const progressPercent =
    playerState.durationMs > 0
      ? (playerState.positionMs / playerState.durationMs) * 100
      : 0;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar */}
      <header className="px-4 py-3 flex items-center justify-between">
        <button
          onClick={onBack}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 19.5 8.25 12l7.5-7.5"
            />
          </svg>
          Library
        </button>
        <SyncIndicator syncState={syncState} onManualSync={onManualSync} />
      </header>

      {/* Cover art area */}
      <div className="flex-1 flex items-center justify-center px-8 py-4">
        {coverArtUrl ? (
          <img
            src={coverArtUrl}
            alt={`${book.name} cover`}
            className="w-full max-w-[280px] aspect-square rounded-xl object-cover shadow-lg border border-border"
          />
        ) : (
          <div className="w-full max-w-[280px] aspect-square rounded-xl bg-gradient-to-br from-primary/20 via-primary/10 to-primary/5 border border-border flex items-center justify-center shadow-lg">
            <div className="text-center space-y-2">
              <svg
                className="mx-auto h-16 w-16 text-primary/60"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"
                />
              </svg>
              <p className="text-sm font-medium text-primary/80 px-4 truncate">
                {book.name}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* File-not-found banner */}
      {playerState.fileNotFound && (
        <div className="mx-6 mb-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 flex items-center gap-3">
          <svg className="h-5 w-5 flex-shrink-0 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-destructive">Files not found</p>
            <p className="text-xs text-muted-foreground">Folder may have been moved or deleted</p>
          </div>
          <button
            onClick={handleRelocateFromPlayer}
            className="flex-shrink-0 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Relocate
          </button>
        </div>
      )}

      {/* Chapter label */}
      <div className="text-center px-6 pb-2">
        <p className="text-sm font-medium text-foreground truncate">
          {chapterLabel}
        </p>
        {playerState.error && !playerState.fileNotFound && (
          <p className="text-xs text-destructive mt-1 truncate">
            {playerState.error}
          </p>
        )}
      </div>

      {/* Progress bar */}
      <div className="px-6 pb-1">
        <SeekBar
          progressPercent={progressPercent}
          durationMs={playerState.durationMs}
          onSeek={controls.seekTo}
        />
        <div className="flex justify-between mt-1.5">
          <span className="text-xs text-muted-foreground">
            {formatTime(playerState.positionMs)}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatTimeRemaining(
              playerState.positionMs,
              playerState.durationMs
            )}
          </span>
        </div>
      </div>

      {/* Transport controls */}
      <div className="flex items-center justify-center gap-6 py-4 px-6">
        {/* Previous chapter */}
        <button
          onClick={controls.prevChapter}
          className="p-2 text-foreground hover:text-primary transition-colors"
          aria-label="Previous chapter"
        >
          <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
          </svg>
        </button>

        {/* Rewind 30s */}
        <button
          onClick={() => controls.seekBy(-30000)}
          className="p-2 text-foreground hover:text-primary transition-colors relative"
          aria-label="Rewind 30 seconds"
        >
          <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9l6-6" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 9h12a6 6 0 0 1 0 12h-3" />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold mt-0.5">
            30
          </span>
        </button>

        {/* Play/Pause */}
        <button
          onClick={controls.togglePlayPause}
          className="w-14 h-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg hover:bg-primary/90 transition-colors"
          aria-label={playerState.isPlaying ? "Pause" : "Play"}
        >
          {playerState.isPlaying ? (
            <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            </svg>
          ) : (
            <svg className="h-6 w-6 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {/* Forward 30s */}
        <button
          onClick={() => controls.seekBy(30000)}
          className="p-2 text-foreground hover:text-primary transition-colors relative"
          aria-label="Forward 30 seconds"
        >
          <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m15 15 6-6-6-6" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 9H9a6 6 0 0 0 0 12h3" />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold mt-0.5">
            30
          </span>
        </button>

        {/* Next chapter */}
        <button
          onClick={controls.nextChapter}
          className="p-2 text-foreground hover:text-primary transition-colors"
          aria-label="Next chapter"
        >
          <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
          </svg>
        </button>
      </div>

      {/* Bottom controls */}
      <div className="flex items-center justify-around px-6 py-4 border-t border-border">
        {/* Speed */}
        <div className="relative">
          <button
            onClick={onToggleSpeedMenu}
            className="flex flex-col items-center gap-1 text-foreground hover:text-primary transition-colors"
          >
            <span className="text-sm font-semibold">
              {playerState.playbackSpeed}x
            </span>
            <span className="text-[10px] text-muted-foreground">Speed</span>
          </button>
          {showSpeedMenu && (
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-card border border-border rounded-lg shadow-lg p-1 min-w-[80px]">
              {SPEEDS.map((speed) => (
                <button
                  key={speed}
                  onClick={() => {
                    controls.setSpeed(speed);
                    onToggleSpeedMenu();
                  }}
                  className={`w-full text-left px-3 py-1.5 text-sm rounded hover:bg-accent transition-colors ${
                    playerState.playbackSpeed === speed
                      ? "text-primary font-medium"
                      : "text-foreground"
                  }`}
                >
                  {speed}x
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Chapters */}
        <button
          onClick={onToggleChapters}
          className="flex flex-col items-center gap-1 text-foreground hover:text-primary transition-colors"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
            />
          </svg>
          <span className="text-[10px] text-muted-foreground">Chapters</span>
        </button>

        {/* Sync button */}
        <button
          onClick={onManualSync}
          className="flex flex-col items-center gap-1 text-foreground hover:text-primary transition-colors"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182"
            />
          </svg>
          <span className="text-[10px] text-muted-foreground">Sync</span>
        </button>
      </div>

      {/* Chapters drawer */}
      {showChapters && (
        <ChaptersDrawer
          chapters={book.chapters}
          currentIndex={playerState.currentChapterIndex}
          onSelect={(index) => {
            controls.skipToChapter(index);
            onToggleChapters();
          }}
          onClose={onToggleChapters}
        />
      )}
    </div>
  );
}
