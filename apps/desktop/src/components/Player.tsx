import { useState, useEffect, useCallback, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useAudioPlayer } from "../hooks/useAudioPlayer";
import { SyncEngine } from "@audiobook/shared";
import type { SyncState, SyncStatus } from "@audiobook/shared";
import type { LocalAudiobook } from "./AppShell";
import { formatTime, formatTimeRemaining } from "../lib/utils";
import { SyncIndicator } from "./SyncIndicator";
import { ChaptersDrawer } from "./ChaptersDrawer";
import type { Id } from "../../../../convex/_generated/dataModel";

interface PlayerProps {
  book: LocalAudiobook;
  convexUrl: string;
  onBack: () => void;
  onConvexIdResolved: (id: string) => void;
}

const localStorageAdapter = {
  getItem: async (key: string) => localStorage.getItem(key),
  setItem: async (key: string, value: string) =>
    localStorage.setItem(key, value),
  removeItem: async (key: string) => localStorage.removeItem(key),
};

const SPEEDS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

export function Player({
  book,
  convexUrl,
  onBack,
  onConvexIdResolved,
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

  const syncEngineRef = useRef<SyncEngine | null>(null);
  const updatePosition = useMutation(api.positions.update);
  const getOrCreate = useMutation(api.audiobooks.getOrCreate);

  const convexId = book.convexId;
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

  // Load initial position from remote or local
  useEffect(() => {
    if (initialLoaded) return;

    if (remotePosition !== undefined) {
      if (remotePosition) {
        setInitialChapter(remotePosition.chapterIndex);
        setInitialPosition(remotePosition.positionMs);
      }
      setInitialLoaded(true);
    } else if (!convexId) {
      // No convex ID, check local storage
      const stored = localStorage.getItem(
        `audiobook_sync_${book.name}_${book.checksum}`
      );
      if (stored) {
        try {
          const pos = JSON.parse(stored);
          setInitialChapter(pos.chapterIndex || 0);
          setInitialPosition(pos.positionMs || 0);
        } catch {
          // ignore
        }
      }
      setInitialLoaded(true);
    }
  }, [remotePosition, convexId, initialLoaded, book]);

  // Initialize sync engine
  useEffect(() => {
    if (!convexId) return;

    const pushFn = async (position: {
      audiobookId: string;
      chapterIndex: number;
      positionMs: number;
    }) => {
      await updatePosition({
        audiobookId: position.audiobookId as Id<"audiobooks">,
        chapterIndex: position.chapterIndex,
        positionMs: position.positionMs,
      });
    };

    const engine = new SyncEngine(convexId, localStorageAdapter, pushFn);
    syncEngineRef.current = engine;

    const unsub = engine.subscribe(setSyncState);
    engine.initialize();

    return () => {
      unsub();
      engine.destroy();
      syncEngineRef.current = null;
    };
  }, [convexId, updatePosition]);

  const handlePositionUpdate = useCallback(
    (chapterIndex: number, positionMs: number) => {
      syncEngineRef.current?.updatePosition(chapterIndex, positionMs);
    },
    []
  );

  const handleChapterChange = useCallback(() => {
    syncEngineRef.current?.onChapterChange();
  }, []);

  const handlePause = useCallback(() => {
    syncEngineRef.current?.onPause();
  }, []);

  const handlePlay = useCallback(() => {
    syncEngineRef.current?.onPlay();
  }, []);

  if (!initialLoaded) {
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
}: PlayerInnerProps) {
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

  const currentChapter = book.chapters[playerState.currentChapterIndex];
  const chapterLabel =
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
      </div>

      {/* Chapter label */}
      <div className="text-center px-6 pb-2">
        <p className="text-sm font-medium text-foreground truncate">
          {chapterLabel}
        </p>
      </div>

      {/* Progress bar */}
      <div className="px-6 pb-1">
        <div
          className="relative h-1.5 bg-secondary rounded-full cursor-pointer group"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const percent = (e.clientX - rect.left) / rect.width;
            controls.seekTo(percent * playerState.durationMs);
          }}
        >
          <div
            className="absolute inset-y-0 left-0 bg-primary rounded-full transition-[width] duration-200"
            style={{ width: `${progressPercent}%` }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-primary rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ left: `calc(${progressPercent}% - 7px)` }}
          />
        </div>
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
