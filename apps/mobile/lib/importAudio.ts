import * as FileSystem from "expo-file-system";
import { toByteArray } from "base64-js";
import { fingerprintFile, recordingFingerprint } from "@audiobook/shared";

/** Own picker copies in documents; picker cache files may disappear after restart. */
export async function importAudio(files: { uri: string; name: string; size: number }[]) {
  if (!FileSystem.documentDirectory) throw new Error("Local document storage unavailable");
  const directory = `${FileSystem.documentDirectory}audiobooks/${Date.now()}-${Math.random().toString(36).slice(2)}/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const imported: typeof files = [];
  const hashes: string[] = [];
  try {
    for (const [index, file] of files.entries()) {
      const extension = file.name.split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "") || "audio";
      const uri = `${directory}${index}.${extension}`;
      await FileSystem.copyAsync({ from: file.uri, to: uri });
      const info = await FileSystem.getInfoAsync(uri, { size: true });
      if (!info.exists || info.isDirectory) throw new Error("Unable to import audio");
      hashes.push(await fingerprintFile(info.size, async (position, length) => toByteArray(await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64, position, length,
      }))));
      imported.push({ ...file, uri, size: info.size });
    }
    return { files: imported, checksum: recordingFingerprint(hashes), discard: () => FileSystem.deleteAsync(directory, { idempotent: true }) };
  } catch (error) {
    await FileSystem.deleteAsync(directory, { idempotent: true });
    throw error;
  }
}
