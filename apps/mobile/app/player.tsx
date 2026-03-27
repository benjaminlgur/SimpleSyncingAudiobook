import { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  Modal,
  Dimensions,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { SyncEngine } from "@audiobook/shared";
import type { SyncState, SyncPushResult, AudiobookMeta, ChapterInfo } from "@audiobook/shared";
import { useMobileAudioPlayer } from "../hooks/useAudioPlayer";
import { Ionicons } from "@expo/vector-icons";
import type { Id } from "../../../convex/_generated/dataModel";

const LIBRARY_KEY = "audiobook_library";
const SPEEDS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

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

  const syncEngineRef = useRef<SyncEngine | null>(null);
  const controlsRef = useRef<{ skipToChapter: (index: number, seekMs?: number) => Promise<void> } | null>(null);
  const updatePosition = useMutation(api.positions.update);
  const getOrCreate = useMutation(api.audiobooks.getOrCreate);

  // Load book from local storage
  useEffect(() => {
    if (!bookKey) return;
    AsyncStorage.getItem(LIBRARY_KEY).then((stored) => {
      if (!stored) return;
      try {
        const library: LocalAudiobook[] = JSON.parse(stored);
        const [name, checksum] = bookKey.split("::");
        const found = library.find(
          (b) => b.name === name && b.checksum === checksum
        );
        if (found) setBook(found);
      } catch {
        // ignore
      }
    });
  }, [bookKey]);

  const convexId = book?.convexId;
  const remotePosition = useQuery(
    api.positions.get,
    convexId ? { audiobookId: convexId as Id<"audiobooks"> } : "skip"
  );

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
        setBook((prev) => (prev ? { ...prev, convexId: result.audiobookId } : prev));
      } catch {
        // Offline
      }
    })();
  }, [book, convexId, getOrCreate]);

  // Load initial position
  useEffect(() => {
    if (initialLoaded || !book) return;
    if (remotePosition !== undefined) {
      if (remotePosition) {
        setInitialChapter(remotePosition.chapterIndex);
        setInitialPosition(remotePosition.positionMs);
      }
      setInitialLoaded(true);
    } else if (!convexId) {
      setInitialLoaded(true);
    }
  }, [remotePosition, convexId, initialLoaded, book]);

  // Initialize sync engine — works with or without a Convex ID.
  useEffect(() => {
    if (!book) return;
    const storageKey = convexId || `local_${book.name}_${book.checksum}`;

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

    const onRemoteNewer = (remote: { chapterIndex: number; positionMs: number }) => {
      controlsRef.current?.skipToChapter(remote.chapterIndex, remote.positionMs);
    };

    const engine = new SyncEngine(storageKey, asyncStorageAdapter, pushFn, onRemoteNewer);
    syncEngineRef.current = engine;
    const unsub = engine.subscribe(setSyncState);

    (async () => {
      const localPos = await engine.initialize();
      if (localPos && !initialLoaded) {
        setInitialChapter(localPos.chapterIndex);
        setInitialPosition(localPos.positionMs);
      }
    })();

    const unsubNet = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable) {
        engine.onReconnect();
      }
    });

    return () => {
      unsub();
      unsubNet();
      engine.destroy();
      syncEngineRef.current = null;
    };
  }, [convexId, updatePosition, book, initialLoaded]);

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

  if (!book || !initialLoaded) {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <Text className="text-gray-500 text-sm">Loading...</Text>
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
  controlsRef: React.MutableRefObject<{ skipToChapter: (index: number, seekMs?: number) => Promise<void> } | null>;
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
    return () => { controlsRef.current = null; };
  }, [controls, controlsRef]);

  const currentChapter = book.chapters[playerState.currentChapterIndex];
  const chapterLabel =
    currentChapter?.title ||
    currentChapter?.filename?.replace(/\.[^/.]+$/, "") ||
    `Chapter ${playerState.currentChapterIndex + 1}`;

  const progressPercent =
    playerState.durationMs > 0
      ? (playerState.positionMs / playerState.durationMs) * 100
      : 0;

  const syncDotColor =
    syncState.status === "synced"
      ? "#22c55e"
      : syncState.status === "syncing"
        ? "#3b82f6"
        : syncState.status === "error"
          ? "#f97316"
          : "#9ca3af";

  return (
    <View className="flex-1 bg-white">
      {/* Header */}
      <View className="px-4 pt-14 pb-3 flex-row items-center justify-between">
        <TouchableOpacity
          onPress={onBack}
          className="flex-row items-center"
        >
          <Ionicons name="chevron-back" size={20} color="#6b7280" />
          <Text className="text-sm text-gray-500 ml-1">Library</Text>
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
          <Text className="text-xs text-gray-500">
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
        <View
          className="w-64 h-64 rounded-2xl bg-orange-50 items-center justify-center"
          style={{ borderWidth: 1, borderColor: "#e5e7eb" }}
        >
          <Ionicons name="book" size={56} color="#f9731660" />
          <Text
            className="text-sm font-medium mt-2 px-4 text-center"
            style={{ color: "#f97316aa" }}
            numberOfLines={2}
          >
            {book.name}
          </Text>
        </View>
      </View>

      {/* Chapter label */}
      <Text
        className="text-sm font-medium text-gray-900 text-center px-6 mb-2"
        numberOfLines={1}
      >
        {chapterLabel}
      </Text>

      {/* Progress bar */}
      <View className="px-6 mb-1">
        <TouchableOpacity
          activeOpacity={1}
          onPress={(e) => {
            const screenWidth = Dimensions.get("window").width - 48;
            const x = e.nativeEvent.locationX;
            const percent = x / screenWidth;
            controls.seekTo(percent * playerState.durationMs);
          }}
        >
          <View className="h-1.5 bg-gray-200 rounded-full">
            <View
              className="h-1.5 bg-primary rounded-full"
              style={{ width: `${progressPercent}%` }}
            />
          </View>
        </TouchableOpacity>
        <View className="flex-row justify-between mt-1.5">
          <Text className="text-xs text-gray-500">
            {formatTime(playerState.positionMs)}
          </Text>
          <Text className="text-xs text-gray-500">
            -{formatTime(Math.max(0, playerState.durationMs - playerState.positionMs))}
          </Text>
        </View>
      </View>

      {/* Transport Controls */}
      <View className="flex-row items-center justify-center py-4 px-6" style={{ gap: 24 }}>
        <TouchableOpacity onPress={controls.prevChapter} className="p-2">
          <Ionicons name="play-skip-back" size={24} color="#1f2937" />
        </TouchableOpacity>

        <TouchableOpacity onPress={() => controls.seekBy(-30000)} className="p-2">
          <Ionicons name="play-back" size={28} color="#1f2937" />
          <Text
            className="absolute text-center font-bold"
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

        <TouchableOpacity onPress={() => controls.seekBy(30000)} className="p-2">
          <Ionicons name="play-forward" size={28} color="#1f2937" />
          <Text
            className="absolute text-center font-bold"
            style={{ fontSize: 7, top: 12, left: 0, right: 0 }}
          >
            30
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={controls.nextChapter} className="p-2">
          <Ionicons name="play-skip-forward" size={24} color="#1f2937" />
        </TouchableOpacity>
      </View>

      {/* Bottom controls */}
      <View className="flex-row items-center justify-around px-6 py-4 border-t border-gray-200">
        <TouchableOpacity
          onPress={onToggleSpeedMenu}
          className="items-center"
        >
          <Text className="text-sm font-semibold text-gray-900">
            {playerState.playbackSpeed}x
          </Text>
          <Text className="text-[10px] text-gray-500 mt-0.5">Speed</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={onToggleChapters}
          className="items-center"
        >
          <Ionicons name="list" size={20} color="#1f2937" />
          <Text className="text-[10px] text-gray-500 mt-0.5">Chapters</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={onManualSync} className="items-center">
          <Ionicons name="sync" size={20} color="#1f2937" />
          <Text className="text-[10px] text-gray-500 mt-0.5">Sync</Text>
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
          <View className="bg-white rounded-t-2xl p-4">
            <Text className="text-sm font-semibold text-gray-900 mb-3">
              Playback Speed
            </Text>
            {SPEEDS.map((s) => (
              <TouchableOpacity
                key={s}
                onPress={() => {
                  controls.setSpeed(s);
                  onToggleSpeedMenu();
                }}
                className="py-3 px-4 rounded-lg"
                style={
                  playerState.playbackSpeed === s
                    ? { backgroundColor: "#fff7ed" }
                    : {}
                }
              >
                <Text
                  className={`text-sm ${playerState.playbackSpeed === s ? "text-primary font-medium" : "text-gray-900"}`}
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
          <View className="bg-white rounded-t-2xl max-h-[60%]">
            <View className="flex-row items-center justify-between px-4 py-3 border-b border-gray-200">
              <Text className="text-sm font-semibold text-gray-900">
                Chapters
              </Text>
              <TouchableOpacity onPress={onToggleChapters}>
                <Ionicons name="close" size={20} color="#6b7280" />
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
                    className="px-4 py-3 flex-row items-center"
                    style={isCurrent ? { backgroundColor: "#fff7ed" } : {}}
                  >
                    <Text className="text-xs text-gray-500 w-6 text-right mr-3">
                      {item.index + 1}
                    </Text>
                    <Text
                      className={`flex-1 text-sm ${isCurrent ? "text-primary font-medium" : "text-gray-900"}`}
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
