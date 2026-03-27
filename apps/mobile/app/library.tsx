import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { computeChecksum } from "@audiobook/shared";
import type { AudiobookMeta, ChapterInfo, FileInfo } from "@audiobook/shared";
import { useConvexContext } from "./_layout";
import { Ionicons } from "@expo/vector-icons";
import { LinkingModal } from "../components/LinkingModal";

const LIBRARY_KEY = "audiobook_library";
const AUDIO_EXTENSIONS = [
  ".mp3", ".m4a", ".m4b", ".ogg", ".opus", ".flac", ".wav", ".aac",
];

interface LocalAudiobook extends AudiobookMeta {
  convexId?: string;
}

function isAudioFile(name: string): boolean {
  const lower = name.toLowerCase();
  return AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export default function LibraryScreen() {
  const [library, setLibrary] = useState<LocalAudiobook[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [linkingBook, setLinkingBook] = useState<LocalAudiobook | null>(null);
  const { setConvexUrl } = useConvexContext();
  const router = useRouter();
  const getOrCreate = useMutation(api.audiobooks.getOrCreate);

  useEffect(() => {
    AsyncStorage.getItem(LIBRARY_KEY).then((stored) => {
      if (stored) {
        try {
          setLibrary(JSON.parse(stored));
        } catch {
          // ignore
        }
      }
    });
  }, []);

  const saveLibrary = useCallback(async (books: LocalAudiobook[]) => {
    setLibrary(books);
    await AsyncStorage.setItem(LIBRARY_KEY, JSON.stringify(books));
  }, []);

  const handlePickFolder = async () => {
    setIsScanning(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "audio/*",
        multiple: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0)
        return;

      const assets = result.assets;
      const audioFiles = assets.filter((a) => isAudioFile(a.name));
      if (audioFiles.length === 0) {
        Alert.alert("No Audio Files", "No audio files found in selection.");
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
        onPress: () => {
          const updated = library.filter(
            (b) => !(b.name === book.name && b.checksum === book.checksum)
          );
          saveLibrary(updated);
        },
      },
    ]);
  };

  const handleDisconnect = () => {
    setConvexUrl(null);
    router.replace("/");
  };

  return (
    <View className="flex-1 bg-white">
      {/* Header */}
      <View className="px-4 pt-14 pb-3 flex-row items-center justify-between border-b border-gray-200">
        <Text className="text-xl font-bold text-gray-900">Library</Text>
        <TouchableOpacity onPress={handleDisconnect}>
          <Text className="text-xs text-gray-500">Disconnect</Text>
        </TouchableOpacity>
      </View>

      <ScrollView className="flex-1 px-4 py-4">
        {library.length === 0 ? (
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
              onPress={() =>
                router.push({
                  pathname: "/player",
                  params: {
                    bookKey: `${book.name}::${book.checksum}`,
                  },
                })
              }
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
              className="flex-row items-center p-4 mb-2 rounded-xl border border-gray-200 bg-white"
            >
              <View className="w-12 h-12 rounded-lg bg-orange-50 items-center justify-center mr-3">
                <Ionicons name="book" size={24} color="#f97316" />
              </View>
              <View className="flex-1">
                <Text
                  className="text-sm font-medium text-gray-900"
                  numberOfLines={1}
                >
                  {book.name}
                </Text>
                <Text className="text-xs text-gray-500">
                  {book.chapters.length} chapter
                  {book.chapters.length !== 1 ? "s" : ""}
                  {book.convexId ? (
                    <Text className="text-green-600"> · Synced</Text>
                  ) : (
                    <Text className="text-yellow-600"> · Local</Text>
                  )}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
            </TouchableOpacity>
          ))
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
