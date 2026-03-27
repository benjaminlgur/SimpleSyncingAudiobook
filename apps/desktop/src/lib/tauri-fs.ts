import { readDir, readFile, stat } from "@tauri-apps/plugin-fs";
import { open } from "@tauri-apps/plugin-dialog";
import type { AudiobookMeta, ChapterInfo, FileInfo } from "@audiobook/shared";
import { computeChecksum } from "@audiobook/shared";

const AUDIO_EXTENSIONS = new Set([
  ".mp3", ".m4a", ".m4b", ".ogg", ".opus", ".flac", ".wav", ".aac", ".wma",
]);

const MIME_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  m4b: "audio/mp4",
  ogg: "audio/ogg",
  opus: "audio/opus",
  flac: "audio/flac",
  wav: "audio/wav",
  aac: "audio/aac",
  wma: "audio/x-ms-wma",
};

function isAudioFile(name: string): boolean {
  const ext = name.substring(name.lastIndexOf(".")).toLowerCase();
  return AUDIO_EXTENSIONS.has(ext);
}

function joinPath(folder: string, file: string): string {
  const sep = folder.includes("\\") ? "\\" : "/";
  return `${folder}${sep}${file}`;
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
        const fileStat = await stat(joinPath(folderPath, entry.name));
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

let currentBlobUrl: string | null = null;

export async function loadAudioFileAsBlob(
  folderPath: string,
  filename: string
): Promise<string> {
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
  }

  const fullPath = joinPath(folderPath, filename);
  const contents = await readFile(fullPath);
  const ext = filename.split(".").pop()?.toLowerCase() || "mp3";
  const mime = MIME_TYPES[ext] || "audio/mpeg";
  const blob = new Blob([contents], { type: mime });
  currentBlobUrl = URL.createObjectURL(blob);
  return currentBlobUrl;
}

export function revokeCurrentAudioBlob() {
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
  }
}
