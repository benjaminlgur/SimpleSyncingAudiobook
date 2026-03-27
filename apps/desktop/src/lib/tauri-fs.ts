import { readDir, stat } from "@tauri-apps/plugin-fs";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { AudiobookMeta, ChapterInfo, FileInfo } from "@audiobook/shared";
import { computeChecksum } from "@audiobook/shared";

const AUDIO_EXTENSIONS = new Set([
  ".mp3", ".m4a", ".m4b", ".ogg", ".opus", ".flac", ".wav", ".aac", ".wma",
]);

function isAudioFile(name: string): boolean {
  const ext = name.substring(name.lastIndexOf(".")).toLowerCase();
  return AUDIO_EXTENSIONS.has(ext);
}

export async function pickAudiobookFolder(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false });
  return selected as string | null;
}

export async function scanAudiobookFolder(
  folderPath: string
): Promise<AudiobookMeta | null> {
  const entries = await readDir(folderPath);

  const audioFiles: { name: string; size: number }[] = [];

  for (const entry of entries) {
    if (entry.isFile && entry.name && isAudioFile(entry.name)) {
      try {
        const fileStat = await stat(`${folderPath}\\${entry.name}`);
        audioFiles.push({ name: entry.name, size: fileStat.size });
      } catch {
        audioFiles.push({ name: entry.name, size: 0 });
      }
    }
  }

  if (audioFiles.length === 0) return null;

  audioFiles.sort((a, b) => a.name.localeCompare(b.name));

  const fileInfos: FileInfo[] = audioFiles.map((f) => ({
    name: f.name,
    size: f.size,
  }));

  const checksum = computeChecksum(fileInfos);

  const chapters: ChapterInfo[] = audioFiles.map((f, i) => ({
    index: i,
    filename: f.name,
  }));

  const folderName = folderPath.split(/[\\/]/).pop() || folderPath;

  return {
    name: folderName,
    checksum,
    chapters,
    folderPath,
  };
}

export function getAudioFileUrl(folderPath: string, filename: string): string {
  const fullPath = `${folderPath}\\${filename}`;
  return convertFileSrc(fullPath);
}
