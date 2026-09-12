import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";

/** Delete only copies owned by this app, keeping files used by other scopes. */
export async function removeImportedAudio(
  folderPath: string,
  libraryKey: string,
  remaining: { folderPath: string }[],
) {
  if (!FileSystem.documentDirectory)
    throw new Error("Local document storage unavailable");
  const root = `${FileSystem.documentDirectory}audiobooks/`;
  const referenced = new Set(
    remaining.flatMap((book) => book.folderPath.split("|")),
  );
  for (const key of await AsyncStorage.getAllKeys()) {
    if (
      key === libraryKey ||
      !(key === "audiobook_library" || key.startsWith("audiobook_library:"))
    )
      continue;
    const stored = await AsyncStorage.getItem(key);
    // Fail closed on corrupted library metadata rather than deleting shared audio.
    const books = JSON.parse(stored ?? "[]") as { folderPath: string }[];
    for (const book of books)
      for (const uri of book.folderPath.split("|")) referenced.add(uri);
  }
  for (const uri of new Set(folderPath.split("|"))) {
    if (referenced.has(uri) || !uri.startsWith(root)) continue;
    const relative = uri.slice(root.length);
    if (!/^[a-zA-Z0-9-]+\/\d+\.[a-zA-Z0-9]+$/.test(relative)) continue;
    await FileSystem.deleteAsync(uri, { idempotent: true });
    const directory = uri.slice(0, uri.lastIndexOf("/") + 1);
    if ((await FileSystem.readDirectoryAsync(directory)).length === 0) {
      await FileSystem.deleteAsync(directory, { idempotent: true });
    }
  }
}
