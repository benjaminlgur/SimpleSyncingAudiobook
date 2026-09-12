// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { removeImportedAudio } from "./removeImportedAudio";
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///app/",
  deleteAsync: vi.fn(async () => {}),
  readDirectoryAsync: vi.fn(async () => []),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getAllKeys: vi.fn(async () => []),
    getItem: vi.fn(async () => null),
  },
}));
beforeEach(() => vi.clearAllMocks());

test("removal frees owned copies and never follows traversal or external URIs", async () => {
  await removeImportedAudio(
    "file:///app/audiobooks/123-abc/0.mp3|file:///app/audiobooks/../secret.txt|content://picked/1.mp3|file:///original/1.mp3",
    "audiobook_library:scope",
    [],
  );
  expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(2);
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith(
    "file:///app/audiobooks/123-abc/0.mp3",
    { idempotent: true },
  );
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith(
    "file:///app/audiobooks/123-abc/",
    { idempotent: true },
  );
});

test("another account's reference keeps a shared audio copy alive", async () => {
  const uri = "file:///app/audiobooks/123-abc/0.mp3";
  vi.mocked(AsyncStorage.getAllKeys).mockResolvedValueOnce([
    "audiobook_library:other",
  ]);
  vi.mocked(AsyncStorage.getItem).mockResolvedValueOnce(
    JSON.stringify([{ folderPath: uri }]),
  );
  await removeImportedAudio(uri, "audiobook_library:scope", []);
  expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
});
