import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
  RefreshControl,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { computeChecksum } from "@audiobook/shared";
import type { AudiobookMeta, ChapterInfo, FileInfo } from "@audiobook/shared";
import { useConvexContext } from "./_layout";
import { Ionicons } from "@expo/vector-icons";
import { LinkingModal } from "../components/LinkingModal";
import { extractCoverArtFromAudioUris } from "../lib/coverArt";

const LIBRARY_KEY = "audiobook_library";
const DEVICE_ID_KEY = "audiobook_device_id";
const AUDIO_EXTENSIONS = [
  ".mp3", ".m4a", ".m4b", ".ogg", ".opus", ".flac", ".wav", ".aac",
];

interface LocalAudiobook extends AudiobookMeta {
  convexId?: string;
  missing?: boolean;
}

interface PickedAudioFile {
  uri: string;
  name: string;
  size: number;
}

function BookThumbnail({ book }: { book: LocalAudiobook }) {
  const [artUrl, setArtUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (book.missing) {
      setArtUrl(null);
      return;
    }

    const uris = book.folderPath.split("|").filter(Boolean);
    if (uris.length === 0) {
      setArtUrl(null);
      return;
    }

    (async () => {
      const art = await extractCoverArtFromAudioUris(uris);
      if (!cancelled) {
        setArtUrl(art);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [book.folderPath, book.missing]);

  if (artUrl) {
    return (
      <Image
        source={{ uri: artUrl }}
        resizeMode="cover"
        className="w-12 h-12 rounded-lg mr-3"
        style={{ borderWidth: 1, borderColor: "#e5e7eb" }}
      />
    );
  }

  return (
    <View
      className="w-12 h-12 rounded-lg items-center justify-center mr-3"
      style={{ backgroundColor: book.missing ? "#fef2f2" : "#fff7ed" }}
    >
      <Ionicons
        name={book.missing ? "warning" : "book"}
        size={24}
        color={book.missing ? "#ef4444" : "#f97316"}
      />
    </View>
  );
}

function isAudioFile(name: string): boolean {
  const lower = name.toLowerCase();
  return AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function decodeUriValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getNameFromUri(uri: string): string {
  const withoutQuery = uri.split("?")[0] ?? uri;
  const lastSegment = withoutQuery.substring(withoutQuery.lastIndexOf("/") + 1);
  const decoded = decodeUriValue(lastSegment);
  const afterColon = decoded.includes(":")
    ? decoded.substring(decoded.lastIndexOf(":") + 1)
    : decoded;
  return afterColon.includes("/")
    ? afterColon.substring(afterColon.lastIndexOf("/") + 1)
    : afterColon;
}

function getFolderNameFromUri(uri: string): string | null {
  const decoded = decodeUriValue(uri);
  const lastSegment = decoded.substring(decoded.lastIndexOf("/") + 1);
  const afterColon = lastSegment.includes(":")
    ? lastSegment.substring(lastSegment.lastIndexOf(":") + 1)
    : lastSegment;
  const name = afterColon.split("/").filter(Boolean).pop();
  return name || null;
}

export default function LibraryScreen() {
  const [library, setLibrary] = useState<LocalAudiobook[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [linkingBook, setLinkingBook] = useState<LocalAudiobook | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const { setConvexUrl, client } = useConvexContext();
  const router = useRouter();
  const getOrCreate = useMutation(api.audiobooks.getOrCreate);
  const registerOnDevice = useMutation(api.audiobooks.registerOnDevice);
  const removeFromDevice = useMutation(api.audiobooks.removeFromDevice);
  const removeFromDatabase = useMutation(api.audiobooks.remove);
  const remoteOnlyBooks = useQuery(
    api.audiobooks.listRemoteForDevice,
    deviceId ? { deviceId, refreshToken } : "skip"
  );
  const remoteOnlyCount = remoteOnlyBooks?.length ?? 0;

  useEffect(() => {
    (async () => {
      const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
      if (existing) {
        setDeviceId(existing);
        return;
      }

      const next = `mobile_${Date.now().toString(36)}_${Math.random()
        .toString(36)
        .slice(2, 10)}`;
      await AsyncStorage.setItem(DEVICE_ID_KEY, next);
      setDeviceId(next);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const stored = await AsyncStorage.getItem(LIBRARY_KEY);
      if (!stored) return;
      try {
        const books: LocalAudiobook[] = JSON.parse(stored);
        const validated = await Promise.all(
          books.map(async (book) => {
            try {
              const firstUri = book.folderPath.split("|")[0];
              const info = await FileSystem.getInfoAsync(firstUri);
              return { ...book, missing: !info.exists };
            } catch {
              return { ...book, missing: true };
            }
          })
        );
        setLibrary(validated);
      } catch {
        // ignore
      }
    })();
  }, []);

  const saveLibrary = useCallback(async (books: LocalAudiobook[]) => {
    setLibrary(books);
    await AsyncStorage.setItem(LIBRARY_KEY, JSON.stringify(books));
  }, []);

  useEffect(() => {
    let cancelled = false;

    const pruneBooksMissingInDatabase = async () => {
      if (!client || library.length === 0) return;

      const booksWithConvexId = library.filter((book) => !!book.convexId);
      if (booksWithConvexId.length === 0) return;

      const missingKeys = new Set<string>();

      await Promise.all(
        booksWithConvexId.map(async (book) => {
          try {
            const doc = await client.query(api.audiobooks.get, {
              id: book.convexId as Id<"audiobooks">,
            });
            if (!doc) {
              missingKeys.add(`${book.name}::${book.checksum}`);
            }
          } catch {
            // Keep local library as-is while offline or if request fails.
          }
        })
      );

      if (missingKeys.size === 0 || cancelled) return;

      const updated = library.filter(
        (book) => !missingKeys.has(`${book.name}::${book.checksum}`)
      );
      await saveLibrary(updated);
    };

    void pruneBooksMissingInDatabase();
    return () => {
      cancelled = true;
    };
  }, [client, library, saveLibrary]);

  useEffect(() => {
    let cancelled = false;

    const registerLocalBooks = async () => {
      if (!deviceId || library.length === 0) return;

      const updated = [...library];
      let changed = false;

      for (let i = 0; i < updated.length; i += 1) {
        const book = updated[i];
        let audiobookId = book.convexId;

        if (!audiobookId) {
          try {
            const result = await getOrCreate({
              name: book.name,
              checksum: book.checksum,
              chapters: book.chapters,
            });
            audiobookId = result.audiobookId;
            updated[i] = { ...book, convexId: audiobookId };
            changed = true;
          } catch {
            continue;
          }
        }

        try {
          await registerOnDevice({
            audiobookId: audiobookId as Id<"audiobooks">,
            deviceId,
            platform: "mobile",
          });
        } catch {
          // Best effort while offline.
        }
      }

      if (changed && !cancelled) {
        await saveLibrary(updated);
      }
    };

    void registerLocalBooks();
    return () => {
      cancelled = true;
    };
  }, [deviceId, getOrCreate, library, registerOnDevice, saveLibrary]);

  const handlePickFolder = async () => {
    setIsScanning(true);
    try {
      let audioFiles: PickedAudioFile[] = [];
      let folderNameHint: string | null = null;

      if (Platform.OS === "android") {
        const permission =
          await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();

        if (!permission.granted) return;

        folderNameHint = getFolderNameFromUri(permission.directoryUri);
        const entryUris =
          await FileSystem.StorageAccessFramework.readDirectoryAsync(
            permission.directoryUri
          );

        const scanned = await Promise.all(
          entryUris.map(async (uri): Promise<PickedAudioFile | null> => {
            try {
              const name = getNameFromUri(uri);
              if (!isAudioFile(name)) return null;

              const info = await FileSystem.getInfoAsync(uri, { size: true });
              if (!info.exists || info.isDirectory) return null;

              return {
                uri,
                name,
                size: info.size || 0,
              };
            } catch {
              return null;
            }
          })
        );

        audioFiles = scanned.filter((file): file is PickedAudioFile => !!file);
      } else {
        const result = await DocumentPicker.getDocumentAsync({
          type: "audio/*",
          multiple: true,
        });

        if (result.canceled || !result.assets || result.assets.length === 0)
          return;

        audioFiles = result.assets
          .filter((asset) => isAudioFile(asset.name))
          .map((asset) => ({
            uri: asset.uri,
            name: asset.name,
            size: asset.size || 0,
          }));
      }

      if (audioFiles.length === 0) {
        Alert.alert("No Audio Files", "No audio files found in selected folder.");
        return;
      }

      audioFiles.sort((a, b) => a.name.localeCompare(b.name));

      const fileInfos: FileInfo[] = audioFiles.map((f) => ({
        name: f.name,
        size: f.size || 0,
      }));

      const checksum = computeChecksum(fileInfos);

      const chapters: ChapterInfo[] = audioFiles.map((f, i) => ({
        index: i,
        filename: f.name,
      }));

      const folderName =
        folderNameHint ||
        audioFiles[0].name.replace(/\.[^/.]+$/, "").split(" - ")[0] ||
        "Audiobook";

      const meta: LocalAudiobook = {
        name: folderName,
        checksum,
        chapters,
        folderPath: audioFiles.map((f) => f.uri).join("|"),
      };

      const existing = library.find(
        (b) => b.name === meta.name && b.checksum === meta.checksum
      );
      if (existing) {
        router.push({
          pathname: "/player",
          params: { bookKey: `${existing.name}::${existing.checksum}` },
        });
        return;
      }

      let convexId: string | undefined;
      try {
        const res = await getOrCreate({
          name: meta.name,
          checksum: meta.checksum,
          chapters: meta.chapters,
        });
        convexId = res.audiobookId;
        if (deviceId) {
          await registerOnDevice({
            audiobookId: res.audiobookId,
            deviceId,
            platform: "mobile",
          });
        }
      } catch {
        // Offline
      }

      const newBook = { ...meta, convexId };
      await saveLibrary([...library, newBook]);
    } catch (err) {
      console.error("Pick error:", err);
    } finally {
      setIsScanning(false);
    }
  };

  const handlePickM4b = async () => {
    setIsScanning(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["audio/mp4", "audio/x-m4b", "audio/*"],
        multiple: false,
      });

      if (result.canceled || !result.assets || result.assets.length === 0)
        return;

      const asset = result.assets[0];
      const ext = asset.name.split(".").pop()?.toLowerCase();
      if (ext !== "m4b" && ext !== "m4a") {
        Alert.alert("Invalid File", "Please select an M4B or M4A audiobook file.");
        return;
      }

      const bookName = asset.name.replace(/\.[^/.]+$/, "");
      const fileInfos: FileInfo[] = [{ name: asset.name, size: asset.size || 0 }];
      const checksum = computeChecksum(fileInfos);

      const chapters: ChapterInfo[] = [{
        index: 0,
        filename: asset.name,
        title: bookName,
        startMs: 0,
        endMs: undefined,
      }];

      const meta: LocalAudiobook = {
        name: bookName,
        checksum,
        chapters,
        folderPath: asset.uri,
      };

      const existing = library.find(
        (b) => b.name === meta.name && b.checksum === meta.checksum
      );
      if (existing) {
        router.push({
          pathname: "/player",
          params: { bookKey: `${existing.name}::${existing.checksum}` },
        });
        return;
      }

      let convexId: string | undefined;
      try {
        const res = await getOrCreate({
          name: meta.name,
          checksum: meta.checksum,
          chapters: meta.chapters,
        });
        convexId = res.audiobookId;
        if (deviceId) {
          await registerOnDevice({
            audiobookId: res.audiobookId,
            deviceId,
            platform: "mobile",
          });
        }
      } catch {
        // Offline
      }

      const newBook = { ...meta, convexId };
      await saveLibrary([...library, newBook]);
    } catch (err) {
      console.error("Pick M4B error:", err);
    } finally {
      setIsScanning(false);
    }
  };

  const handleRemove = (book: LocalAudiobook) => {
    Alert.alert("Remove Audiobook", `Remove "${book.name}" from library?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          if (deviceId && book.convexId) {
            try {
              await removeFromDevice({
                audiobookId: book.convexId as Id<"audiobooks">,
                deviceId,
              });
            } catch {
              // Keep local remove responsive if network is unavailable.
            }
          }

          const updated = library.filter(
            (b) => !(b.name === book.name && b.checksum === book.checksum)
          );
          await saveLibrary(updated);
        },
      },
    ]);
  };

  const handleDisconnect = () => {
    setConvexUrl(null);
    router.replace("/");
  };

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setRefreshToken((prev) => prev + 1);
    await new Promise((resolve) => setTimeout(resolve, 500));
    setIsRefreshing(false);
  }, []);

  return (
    <View className="flex-1 bg-white">
      {/* Header */}
      <View className="px-4 pt-14 pb-3 flex-row items-center justify-between border-b border-gray-200">
        <Text className="text-xl font-bold text-gray-900">Library</Text>
        <TouchableOpacity onPress={handleDisconnect}>
          <Text className="text-xs text-gray-500">Disconnect</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        className="flex-1 px-4 py-4"
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => {
              void handleRefresh();
            }}
            tintColor="#6b7280"
          />
        }
      >
        {library.length === 0 && remoteOnlyCount === 0 ? (
          <View className="items-center justify-center py-20">
            <Ionicons name="book-outline" size={48} color="#d1d5db" />
            <Text className="text-sm text-gray-500 mt-4">
              No audiobooks yet
            </Text>
            <Text className="text-xs text-gray-400 mt-1">
              Add audio files to get started
            </Text>
          </View>
        ) : (
          library.map((book) => (
            <TouchableOpacity
              key={`${book.name}-${book.checksum}`}
              onPress={() => {
                if (book.missing) {
                  Alert.alert(
                    "Files Missing",
                    `The audio files for "${book.name}" can no longer be found. They may have been moved or deleted.\n\nPlease re-add the audiobook from its new location.`,
                    [
                      { text: "OK", style: "cancel" },
                      { text: "Remove", style: "destructive", onPress: () => handleRemove(book) },
                    ]
                  );
                  return;
                }
                router.push({
                  pathname: "/player",
                  params: {
                    bookKey: `${book.name}::${book.checksum}`,
                  },
                });
              }}
              onLongPress={() => {
                if (book.convexId) {
                  Alert.alert(book.name, "Choose an action", [
                    { text: "Cancel", style: "cancel" },
                    { text: "Link/Unlink", onPress: () => setLinkingBook(book) },
                    { text: "Remove", style: "destructive", onPress: () => handleRemove(book) },
                  ]);
                } else {
                  handleRemove(book);
                }
              }}
              className="flex-row items-center p-4 mb-2 rounded-xl border bg-white"
              style={{ borderColor: book.missing ? "#fca5a5" : "#e5e7eb" }}
            >
              <BookThumbnail book={book} />
              <View className="flex-1">
                <Text
                  className="text-sm font-medium"
                  style={{ color: book.missing ? "#9ca3af" : "#111827" }}
                  numberOfLines={1}
                >
                  {book.name}
                </Text>
                {book.missing ? (
                  <Text className="text-xs" style={{ color: "#ef4444" }}>
                    Files missing — tap to learn more
                  </Text>
                ) : (
                  <Text className="text-xs text-gray-500">
                    {book.chapters.length} chapter
                    {book.chapters.length !== 1 ? "s" : ""}
                    {book.convexId ? (
                      <Text className="text-green-600"> · Synced</Text>
                    ) : (
                      <Text className="text-yellow-600"> · Local</Text>
                    )}
                  </Text>
                )}
              </View>
              <Ionicons
                name={book.missing ? "alert-circle" : "chevron-forward"}
                size={16}
                color={book.missing ? "#ef4444" : "#9ca3af"}
              />
            </TouchableOpacity>
          ))
        )}

        {remoteOnlyBooks && remoteOnlyBooks.length > 0 && (
          <View className="mt-6">
            <View className="flex-row items-center mb-3">
              <Ionicons name="cloud-outline" size={16} color="#6b7280" />
              <Text className="text-xs font-semibold text-gray-500 ml-1.5 uppercase tracking-wide">
                On another device ({remoteOnlyBooks.length})
              </Text>
            </View>
            {remoteOnlyBooks.map((book) => (
              <View
                key={`remote-${book._id}`}
                className="p-4 mb-2 rounded-xl border"
                style={{ borderColor: "#e0e7ff", backgroundColor: "#f5f7ff" }}
              >
                <View className="flex-row items-center">
                <View
                  className="w-12 h-12 rounded-lg items-center justify-center mr-3"
                  style={{ backgroundColor: "#eef2ff" }}
                >
                  <Ionicons name="cloud-outline" size={24} color="#818cf8" />
                </View>
                <View className="flex-1">
                  <Text
                    className="text-sm font-medium"
                    style={{ color: "#6b7280" }}
                    numberOfLines={1}
                  >
                    {book.name}
                  </Text>
                  <Text className="text-xs" style={{ color: "#9ca3af" }}>
                    {book.chapters.length} chapter
                    {book.chapters.length !== 1 ? "s" : ""} · Add local files to listen
                  </Text>
                </View>
                </View>
                <View className="flex-row mt-3" style={{ marginLeft: 60 }}>
                  <TouchableOpacity
                    onPress={() =>
                      Alert.alert(
                        "Not on this device",
                        `"${book.name}" was added on another device. To listen here, add the same audio files using the buttons below.`
                      )
                    }
                    className="px-3 py-1.5 rounded-md border mr-2"
                    style={{ borderColor: "#c7d2fe" }}
                  >
                    <Text className="text-xs" style={{ color: "#6366f1" }}>
                      Info
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() =>
                      Alert.alert(
                        "Remove from database",
                        `Remove \"${book.name}\" from the shared database for all devices?`,
                        [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Remove",
                            style: "destructive",
                            onPress: async () => {
                              try {
                                await removeFromDatabase({ id: book._id });
                              } catch {
                                Alert.alert(
                                  "Unable to remove",
                                  "Couldn't remove this audiobook from the database right now."
                                );
                              }
                            },
                          },
                        ]
                      )
                    }
                    className="px-3 py-1.5 rounded-md border"
                    style={{ borderColor: "#fca5a5" }}
                  >
                    <Text className="text-xs" style={{ color: "#dc2626" }}>
                      Remove
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        {remoteOnlyBooks === undefined && library.length === 0 && (
          <View className="items-center py-4">
            <Text className="text-xs text-gray-400">
              Unable to check other devices right now
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Add buttons */}
      <View className="p-4 border-t border-gray-200">
        {isScanning ? (
          <View className="bg-gray-200 rounded-xl py-3.5 items-center">
            <Text className="text-gray-500 font-medium text-sm">Scanning...</Text>
          </View>
        ) : (
          <View className="flex-row gap-2">
            <TouchableOpacity
              onPress={handlePickFolder}
              className="flex-1 bg-primary rounded-xl py-3.5 items-center flex-row justify-center"
            >
              <Ionicons name="folder-open-outline" size={18} color="white" />
              <Text className="text-white font-medium text-sm ml-1">
                Add Folder
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handlePickM4b}
              className="flex-1 rounded-xl py-3.5 items-center flex-row justify-center border border-primary"
            >
              <Ionicons name="document-outline" size={18} color="#6366f1" />
              <Text className="text-primary font-medium text-sm ml-1">
                Add M4B
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {linkingBook?.convexId && (
        <LinkingModal
          visible={!!linkingBook}
          audiobookId={linkingBook.convexId}
          audiobookName={linkingBook.name}
          onClose={() => setLinkingBook(null)}
        />
      )}
    </View>
  );
}
