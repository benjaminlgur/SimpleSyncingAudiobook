import { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  Modal,
  Image,
  ActivityIndicator,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { SyncEngine } from "@audiobook/shared";
import type {
  SyncState,
  SyncPushResult,
  AudiobookMeta,
  ChapterInfo,
} from "@audiobook/shared";
import { useMobileAudioPlayer } from "../hooks/useAudioPlayer";
import { extractCoverArtFromAudioUris } from "../lib/coverArt";
import { Ionicons } from "@expo/vector-icons";
import type { Id } from "../../../convex/_generated/dataModel";
import { useTheme } from "../hooks/useTheme";

const LIBRARY_KEY = "audiobook_library";
const LAST_PLAYING_BOOK_KEY = "audiobook_last_playing_book_key";
const SPEEDS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
const PROGRESS_THUMB_SIZE = 16;
const PROGRESS_THUMB_RADIUS = PROGRESS_THUMB_SIZE / 2;
const REMOTE_POSITION_PROMPT_DELAY_MS = 12_000;

interface LocalAudiobook extends AudiobookMeta {
  convexId?: string;
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

const asyncStorageAdapter = {
  getItem: (key: string) => AsyncStorage.getItem(key),
  setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
  removeItem: (key: string) => AsyncStorage.removeItem(key),
};

export default function PlayerScreen() {
  const { bookKey } = useLocalSearchParams<{ bookKey: string }>();
  const router = useRouter();
  const [book, setBook] = useState<LocalAudiobook | null>(null);
  const [syncState, setSyncState] = useState<SyncState>({
    status: "idle",
    pending: null,
    lastSyncedAt: null,
    lastError: null,
  });
  const [showChapters, setShowChapters] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [initialChapter, setInitialChapter] = useState(0);
  const [initialPosition, setInitialPosition] = useState(0);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [localInitResolved, setLocalInitResolved] = useState(false);
  const [showOfflinePrompt, setShowOfflinePrompt] = useState(false);
  const [networkStatus, setNetworkStatus] = useState<
    "unknown" | "online" | "offline"
  >("unknown");

  const syncEngineRef = useRef<SyncEngine | null>(null);
  const controlsRef = useRef<{
    skipToChapter: (index: number, seekMs?: number) => Promise<void>;
  } | null>(null);
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
    let active = true;

    const applyNetworkState = ({
      isConnected,
      isInternetReachable,
    }: {
      isConnected: boolean | null;
      isInternetReachable: boolean | null;
    }) => {
      if (isConnected === false || isInternetReachable === false) {
        setNetworkStatus("offline");
      } else if (isConnected === true && isInternetReachable === true) {
        setNetworkStatus("online");
      } else if (isConnected === true) {
        setNetworkStatus("unknown");
      }
    };

    NetInfo.fetch().then((state) => {
      if (!active) return;
      applyNetworkState(state);
    });

    const unsubNet = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable) {
        syncEngineRef.current?.onReconnect();
      }
      applyNetworkState(state);
    });

    return () => {
      active = false;
      unsubNet();
    };
  }, []);

  // Load book from local storage
  useEffect(() => {
    if (!bookKey) return;
    AsyncStorage.setItem(LAST_PLAYING_BOOK_KEY, bookKey).catch(() => {
      // Non-fatal; notification deep-link fallback will use library route.
    });

    AsyncStorage.getItem(LIBRARY_KEY).then((stored) => {
      if (!stored) return;
      try {
        const library: LocalAudiobook[] = JSON.parse(stored);
        const [name, checksum] = bookKey.split("::");
        const found = library.find(
          (b) => b.name === name && b.checksum === checksum,
        );
        if (found) setBook(found);
      } catch {
        // ignore
      }
    });
  }, [bookKey]);

  useEffect(() => {
    setInitialChapter(0);
    setInitialPosition(0);
    setInitialLoaded(false);
    setLocalInitResolved(false);
    setShowOfflinePrompt(false);
    initialLoadedRef.current = false;
    usedFallbackStartupRef.current = false;
    playbackProgressedRef.current = false;
    lateRemoteAppliedRef.current = false;
  }, [bookKey]);

  const convexId = book?.convexId;
  const syncStorageKey = book
    ? convexId || `local_${book.name}_${book.checksum}`
    : null;
  const remotePosition = useQuery(
    api.positions.get,
    convexId ? { audiobookId: convexId as Id<"audiobooks"> } : "skip",
  );

  useEffect(() => {
    if (!syncStorageKey) return;
    setLocalInitResolved(false);
  }, [syncStorageKey]);

  // Resolve Convex ID
  useEffect(() => {
    if (!book || convexId) return;
    (async () => {
      try {
        const result = await getOrCreate({
          name: book.name,
          checksum: book.checksum,
          chapters: book.chapters,
        });
        setBook((prev) =>
          prev ? { ...prev, convexId: result.audiobookId } : prev,
        );
      } catch {
        // Offline
      }
    })();
  }, [book, convexId, getOrCreate]);

  // Prefer remote position when it arrives — dismiss offline prompt if showing.
  useEffect(() => {
    if (initialLoaded || !book) return;
    if (remotePosition === undefined) return;

    if (remotePosition) {
      setInitialChapter(remotePosition.chapterIndex);
      setInitialPosition(remotePosition.positionMs);
    }
    usedFallbackStartupRef.current = false;
    setShowOfflinePrompt(false);
    setInitialLoaded(true);
  }, [remotePosition, initialLoaded, book]);

  // If local state is ready first, only show the warning immediately when
  // we know the device is offline. Otherwise keep waiting for the remote sync.
  useEffect(() => {
    if (initialLoaded || !book || !localInitResolved) return;
    if (remotePosition !== undefined) return;

    if (convexId) {
      if (networkStatus === "offline") {
        setShowOfflinePrompt(true);
      }
    } else {
      setInitialLoaded(true);
    }
  }, [
    convexId,
    initialLoaded,
    localInitResolved,
    networkStatus,
    remotePosition,
    book,
  ]);

  // If remote sync stays unresolved for a while even while online, then
  // let the user decide whether to continue from local state.
  useEffect(() => {
    if (initialLoaded || showOfflinePrompt || !book) return;
    if (!convexId || remotePosition !== undefined || !localInitResolved) return;

    const timeoutId = setTimeout(() => {
      if (initialLoadedRef.current) return;
      setShowOfflinePrompt(true);
    }, REMOTE_POSITION_PROMPT_DELAY_MS);

    return () => clearTimeout(timeoutId);
  }, [
    book,
    convexId,
    initialLoaded,
    localInitResolved,
    remotePosition,
    showOfflinePrompt,
  ]);

  const handleContinueOffline = useCallback(() => {
    usedFallbackStartupRef.current = true;
    setShowOfflinePrompt(false);
    setInitialLoaded(true);
  }, []);

  // If we started from fallback state, adopt remote position once
  // if playback has not progressed yet.
  useEffect(() => {
    if (!book || !initialLoaded || !remotePosition) return;
    if (!usedFallbackStartupRef.current) return;
    if (lateRemoteAppliedRef.current || playbackProgressedRef.current) return;

    lateRemoteAppliedRef.current = true;
    setInitialChapter(remotePosition.chapterIndex);
    setInitialPosition(remotePosition.positionMs);
    void controlsRef.current?.skipToChapter(
      remotePosition.chapterIndex,
      remotePosition.positionMs,
    );
  }, [book, initialLoaded, remotePosition]);

  // Initialize sync engine — works with or without a Convex ID.
  useEffect(() => {
    if (!book || !syncStorageKey) return;
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
      controlsRef.current?.skipToChapter(
        remote.chapterIndex,
        remote.positionMs,
      );
    };

    const engine = new SyncEngine(
      syncStorageKey,
      asyncStorageAdapter,
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
  }, [convexId, updatePosition, book, syncStorageKey]);

  const handlePositionUpdate = useCallback(
    (chapterIndex: number, positionMs: number) => {
      if (chapterIndex > 0 || positionMs > 0) {
        playbackProgressedRef.current = true;
      }
      syncEngineRef.current?.updatePosition(chapterIndex, positionMs);
    },
    [],
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

  if (!book || !initialLoaded) {
    if (showOfflinePrompt && book) {
      return (
        <View className="flex-1 bg-white dark:bg-gray-950 items-center justify-center px-8">
          <Ionicons name="cloud-offline-outline" size={48} color="#f97316" />
          <Text className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-4 text-center">
            Unable to Sync
          </Text>
          <Text className="text-sm text-gray-500 dark:text-gray-400 mt-2 text-center leading-5">
            The latest position for "{book.name}" couldn't be loaded from the
            server. Continuing with your local position may cause sync conflicts
            if you've listened on another device.
          </Text>
          <TouchableOpacity
            onPress={handleContinueOffline}
            className="mt-6 bg-primary rounded-xl px-6 py-3"
          >
            <Text className="text-white font-medium text-sm">
              Continue with Local Position
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.back()} className="mt-3 py-2">
            <Text className="text-sm text-gray-500 dark:text-gray-400">
              Go Back
            </Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View className="flex-1 bg-white dark:bg-gray-950 items-center justify-center">
        <ActivityIndicator size="small" color="#f97316" />
        <Text className="text-gray-500 dark:text-gray-400 text-sm mt-3">
          Loading...
        </Text>
      </View>
    );
  }

  const fileUris = book.folderPath.split("|");

  return (
    <PlayerInner
      book={book}
      fileUris={fileUris}
      initialChapter={initialChapter}
      initialPosition={initialPosition}
      syncState={syncState}
      showChapters={showChapters}
      showSpeedMenu={showSpeedMenu}
      onToggleChapters={() => setShowChapters(!showChapters)}
      onToggleSpeedMenu={() => setShowSpeedMenu(!showSpeedMenu)}
      onBack={() => router.back()}
      onPositionUpdate={handlePositionUpdate}
      onChapterChange={handleChapterChange}
      onPause={handlePause}
      onPlay={handlePlay}
      onManualSync={() => syncEngineRef.current?.manualSync()}
      controlsRef={controlsRef}
    />
  );
}

interface PlayerInnerProps {
  book: LocalAudiobook;
  fileUris: string[];
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
  controlsRef: React.MutableRefObject<{
    skipToChapter: (index: number, seekMs?: number) => Promise<void>;
  } | null>;
}

function PlayerInner({
  book,
  fileUris,
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
  controlsRef,
}: PlayerInnerProps) {
  const [progressBarWidth, setProgressBarWidth] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubPositionMs, setScrubPositionMs] = useState<number | null>(null);
  const [coverArtUrl, setCoverArtUrl] = useState<string | null>(null);

  const [playerState, controls] = useMobileAudioPlayer({
    fileUris,
    chapters: book.chapters,
    initialChapterIndex: initialChapter,
    initialPositionMs: initialPosition,
    onPositionUpdate,
    onChapterChange,
    onPause,
    onPlay,
  });

  useEffect(() => {
    controlsRef.current = controls;
    return () => {
      controlsRef.current = null;
    };
  }, [controls, controlsRef]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const art = await extractCoverArtFromAudioUris(fileUris);
      if (!cancelled) {
        setCoverArtUrl(art);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fileUris]);

  const currentChapter = book.chapters[playerState.currentChapterIndex];
  const chapterLabel =
    currentChapter?.title ||
    currentChapter?.filename?.replace(/\.[^/.]+$/, "") ||
    `Chapter ${playerState.currentChapterIndex + 1}`;

  const displayedPositionMs =
    isScrubbing && scrubPositionMs !== null
      ? scrubPositionMs
      : playerState.positionMs;
  const displayedProgressPercent =
    playerState.durationMs > 0
      ? Math.max(
          0,
          Math.min(100, (displayedPositionMs / playerState.durationMs) * 100),
        )
      : 0;
  const progressThumbCenterX =
    progressBarWidth > 0
      ? Math.max(
          PROGRESS_THUMB_RADIUS,
          Math.min(
            progressBarWidth - PROGRESS_THUMB_RADIUS,
            (displayedProgressPercent / 100) * progressBarWidth,
          ),
        )
      : 0;
  const progressThumbLeft = Math.max(
    0,
    progressThumbCenterX - PROGRESS_THUMB_RADIUS,
  );

  const getSeekMsFromLocationX = useCallback(
    (locationX: number) => {
      if (playerState.durationMs <= 0 || progressBarWidth <= 0) return 0;
      const clampedX = Math.max(0, Math.min(locationX, progressBarWidth));
      return (clampedX / progressBarWidth) * playerState.durationMs;
    },
    [playerState.durationMs, progressBarWidth],
  );

  const handleProgressBarLayout = useCallback((event: LayoutChangeEvent) => {
    setProgressBarWidth(event.nativeEvent.layout.width);
  }, []);

  const handleScrubStart = useCallback(
    (event: GestureResponderEvent) => {
      const nextPositionMs = getSeekMsFromLocationX(
        event.nativeEvent.locationX,
      );
      setIsScrubbing(true);
      setScrubPositionMs(nextPositionMs);
    },
    [getSeekMsFromLocationX],
  );

  const handleScrubMove = useCallback(
    (event: GestureResponderEvent) => {
      if (!isScrubbing) return;
      const nextPositionMs = getSeekMsFromLocationX(
        event.nativeEvent.locationX,
      );
      setScrubPositionMs(nextPositionMs);
    },
    [getSeekMsFromLocationX, isScrubbing],
  );

  const handleScrubEnd = useCallback(
    (event: GestureResponderEvent) => {
      if (!isScrubbing) return;
      const nextPositionMs = getSeekMsFromLocationX(
        event.nativeEvent.locationX,
      );
      setIsScrubbing(false);
      setScrubPositionMs(null);
      void controls.seekTo(nextPositionMs);
    },
    [controls, getSeekMsFromLocationX, isScrubbing],
  );

  const handleScrubCancel = useCallback(() => {
    setIsScrubbing(false);
    setScrubPositionMs(null);
  }, []);

  const { isDark } = useTheme();

  const syncDotColor =
    syncState.status === "synced"
      ? "#22c55e"
      : syncState.status === "syncing"
        ? "#3b82f6"
        : syncState.status === "error"
          ? "#f97316"
          : "#9ca3af";

  const iconColor = isDark ? "#e5e7eb" : "#1f2937";
  const mutedColor = isDark ? "#9ca3af" : "#6b7280";

  return (
    <View className="flex-1 bg-white dark:bg-gray-950">
      {/* Header */}
      <View className="px-4 pt-2 pb-3 flex-row items-center justify-between">
        <TouchableOpacity onPress={onBack} className="flex-row items-center">
          <Ionicons name="chevron-back" size={20} color={mutedColor} />
          <Text className="text-sm text-gray-500 dark:text-gray-400 ml-1">
            Library
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={onManualSync}
          className="flex-row items-center"
        >
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: syncDotColor,
              marginRight: 6,
            }}
          />
          <Text className="text-xs text-gray-500 dark:text-gray-400">
            {syncState.status === "synced"
              ? "Synced"
              : syncState.status === "syncing"
                ? "Syncing..."
                : syncState.status === "error"
                  ? "Sync failed"
                  : "Not synced"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Cover Art */}
      <View className="flex-1 items-center justify-center px-8">
        {coverArtUrl ? (
          <Image
            source={{ uri: coverArtUrl }}
            resizeMode="cover"
            className="w-64 h-64 rounded-2xl border border-gray-200 dark:border-gray-700"
          />
        ) : (
          <View className="w-64 h-64 rounded-2xl bg-orange-50 dark:bg-orange-950/30 items-center justify-center border border-gray-200 dark:border-gray-700">
            <Ionicons name="book" size={56} color="#f9731660" />
            <Text
              className="text-sm font-medium mt-2 px-4 text-center"
              style={{ color: "#f97316aa" }}
              numberOfLines={2}
            >
              {book.name}
            </Text>
          </View>
        )}
      </View>

      {/* Error banner */}
      {playerState.error && (
        <View className="mx-6 mb-2 rounded-lg p-3 flex-row items-center bg-red-50 dark:bg-red-950/30 border border-red-300 dark:border-red-900">
          <Ionicons name="warning" size={18} color="#ef4444" />
          <View className="flex-1 ml-2">
            <Text className="text-xs font-medium text-red-500">
              Playback Error
            </Text>
            <Text
              className="text-xs text-gray-500 dark:text-gray-400"
              numberOfLines={2}
            >
              {playerState.error}
            </Text>
          </View>
          <TouchableOpacity onPress={onBack}>
            <Text className="text-xs font-medium text-indigo-500 dark:text-indigo-400">
              Go Back
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Chapter label */}
      <Text
        className="text-sm font-medium text-gray-900 dark:text-gray-100 text-center px-6 mb-2"
        numberOfLines={1}
      >
        {chapterLabel}
      </Text>

      {/* Progress bar */}
      <View className="px-6 mb-1">
        <View
          onLayout={handleProgressBarLayout}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={handleScrubStart}
          onResponderMove={handleScrubMove}
          onResponderRelease={handleScrubEnd}
          onResponderTerminate={handleScrubCancel}
          className="py-3 -my-3"
        >
          <View className="h-5 justify-center">
            <View className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full">
              <View
                className="h-1.5 bg-primary rounded-full"
                style={{ width: `${displayedProgressPercent}%` }}
              />
            </View>
            <View
              style={{
                position: "absolute",
                left: progressThumbLeft,
                top: 2,
                width: PROGRESS_THUMB_SIZE,
                height: PROGRESS_THUMB_SIZE,
                borderRadius: PROGRESS_THUMB_RADIUS,
                backgroundColor: "#f97316",
                borderWidth: 2,
                borderColor: isDark ? "#030712" : "#ffffff",
                shadowColor: "#000000",
                shadowOpacity: 0.18,
                shadowRadius: 2,
                shadowOffset: { width: 0, height: 1 },
                elevation: 2,
              }}
            />
          </View>
        </View>
        <View className="flex-row justify-between mt-1.5">
          <Text className="text-xs text-gray-500 dark:text-gray-400">
            {formatTime(displayedPositionMs)}
          </Text>
          <Text className="text-xs text-gray-500 dark:text-gray-400">
            -
            {formatTime(
              Math.max(0, playerState.durationMs - displayedPositionMs),
            )}
          </Text>
        </View>
      </View>

      {/* Transport Controls */}
      <View
        className="flex-row items-center justify-center py-4 px-6"
        style={{ gap: 24 }}
      >
        <TouchableOpacity onPress={controls.prevChapter} className="p-2">
          <Ionicons name="play-skip-back" size={24} color={iconColor} />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => controls.seekBy(-30000)}
          className="p-2"
        >
          <Ionicons name="play-back" size={28} color={iconColor} />
          <Text
            className="absolute text-center font-bold text-gray-900 dark:text-gray-100"
            style={{ fontSize: 7, top: 12, left: 0, right: 0 }}
          >
            30
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={controls.togglePlayPause}
          className="w-14 h-14 rounded-full bg-primary items-center justify-center"
          style={{ elevation: 4 }}
        >
          <Ionicons
            name={playerState.isPlaying ? "pause" : "play"}
            size={24}
            color="white"
            style={playerState.isPlaying ? {} : { marginLeft: 2 }}
          />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => controls.seekBy(30000)}
          className="p-2"
        >
          <Ionicons name="play-forward" size={28} color={iconColor} />
          <Text
            className="absolute text-center font-bold text-gray-900 dark:text-gray-100"
            style={{ fontSize: 7, top: 12, left: 0, right: 0 }}
          >
            30
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={controls.nextChapter} className="p-2">
          <Ionicons name="play-skip-forward" size={24} color={iconColor} />
        </TouchableOpacity>
      </View>

      {/* Bottom controls */}
      <View className="flex-row items-center justify-around px-6 py-4 border-t border-gray-200 dark:border-gray-800">
        <TouchableOpacity onPress={onToggleSpeedMenu} className="items-center">
          <Text className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {playerState.playbackSpeed}x
          </Text>
          <Text className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
            Speed
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={onToggleChapters} className="items-center">
          <Ionicons name="list" size={20} color={iconColor} />
          <Text className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
            Chapters
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={onManualSync} className="items-center">
          <Ionicons name="sync" size={20} color={iconColor} />
          <Text className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
            Sync
          </Text>
        </TouchableOpacity>
      </View>

      {/* Speed Menu Modal */}
      <Modal
        visible={showSpeedMenu}
        transparent
        animationType="fade"
        onRequestClose={onToggleSpeedMenu}
      >
        <TouchableOpacity
          className="flex-1 bg-black/40 justify-end"
          activeOpacity={1}
          onPress={onToggleSpeedMenu}
        >
          <View className="bg-white dark:bg-gray-900 rounded-t-2xl p-4">
            <Text className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
              Playback Speed
            </Text>
            {SPEEDS.map((s) => (
              <TouchableOpacity
                key={s}
                onPress={() => {
                  controls.setSpeed(s);
                  onToggleSpeedMenu();
                }}
                className={`py-3 px-4 rounded-lg ${
                  playerState.playbackSpeed === s
                    ? "bg-orange-50 dark:bg-orange-950/30"
                    : ""
                }`}
              >
                <Text
                  className={`text-sm ${playerState.playbackSpeed === s ? "text-primary font-medium" : "text-gray-900 dark:text-gray-100"}`}
                >
                  {s}x
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Chapters Modal */}
      <Modal
        visible={showChapters}
        transparent
        animationType="slide"
        onRequestClose={onToggleChapters}
      >
        <TouchableOpacity
          className="flex-1 bg-black/40 justify-end"
          activeOpacity={1}
          onPress={onToggleChapters}
        >
          <View className="bg-white dark:bg-gray-900 rounded-t-2xl max-h-[60%]">
            <View className="flex-row items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
              <Text className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Chapters
              </Text>
              <TouchableOpacity onPress={onToggleChapters}>
                <Ionicons name="close" size={20} color={mutedColor} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={book.chapters}
              keyExtractor={(item) => `ch-${item.index}`}
              renderItem={({ item }) => {
                const label =
                  item.title ||
                  item.filename?.replace(/\.[^/.]+$/, "") ||
                  `Chapter ${item.index + 1}`;
                const isCurrent =
                  item.index === playerState.currentChapterIndex;

                return (
                  <TouchableOpacity
                    onPress={() => {
                      controls.skipToChapter(item.index);
                      onToggleChapters();
                    }}
                    className={`px-4 py-3 flex-row items-center ${
                      isCurrent ? "bg-orange-50 dark:bg-orange-950/30" : ""
                    }`}
                  >
                    <Text className="text-xs text-gray-500 dark:text-gray-400 w-6 text-right mr-3">
                      {item.index + 1}
                    </Text>
                    <Text
                      className={`flex-1 text-sm ${isCurrent ? "text-primary font-medium" : "text-gray-900 dark:text-gray-100"}`}
                      numberOfLines={1}
                    >
                      {label}
                    </Text>
                    {isCurrent && (
                      <Ionicons name="play" size={14} color="#f97316" />
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}
