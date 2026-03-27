import { readDir, readFile, stat, exists } from "@tauri-apps/plugin-fs";
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

function parentDir(filePath: string): string {
  const sepIdx = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return sepIdx > 0 ? filePath.substring(0, sepIdx) : filePath;
}

function baseName(filePath: string): string {
  const sepIdx = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return sepIdx >= 0 ? filePath.substring(sepIdx + 1) : filePath;
}

export async function checkPathExists(path: string): Promise<boolean> {
  try {
    return await exists(path);
  } catch {
    return false;
  }
}

export async function pickAudiobookFolder(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false });
  return selected as string | null;
}

export async function pickAudiobookFile(): Promise<string | null> {
  const selected = await open({
    directory: false,
    multiple: false,
    filters: [{ name: "Audiobook", extensions: ["m4b", "m4a", "mp3"] }],
  });
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

function chapterStartSec(ch: { sampleOffset: number; start?: number; timescale?: number }, sampleRate: number): number {
  if (ch.start !== undefined && ch.timescale !== undefined && ch.timescale > 0) {
    return ch.start / ch.timescale;
  }
  return ch.sampleOffset / (sampleRate || 44100);
}

export async function scanM4bFile(
  filePath: string
): Promise<AudiobookMeta | null> {
  const fileStat = await stat(filePath);
  const data = await readFile(filePath);

  const { parseBuffer } = await import("music-metadata");
  const metadata = await parseBuffer(data, {
    mimeType: "audio/mp4",
    size: fileStat.size,
  });

  const totalDurationMs = (metadata.format.duration || 0) * 1000;
  const sampleRate = metadata.format.sampleRate || 44100;
  const fileName = baseName(filePath);
  const bookName = fileName.replace(/\.[^/.]+$/, "");
  const folder = parentDir(filePath);

  let chapters: ChapterInfo[];

  const rawChapters = (metadata as { chapters?: Array<{ sampleOffset: number; title?: string; start?: number; timescale?: number }> }).chapters;

  if (rawChapters && rawChapters.length > 1) {
    chapters = rawChapters.map((ch, i) => {
      const startSec = chapterStartSec(ch, sampleRate);
      const startMs = Math.round(startSec * 1000);
      const nextStartSec = i + 1 < rawChapters.length
        ? chapterStartSec(rawChapters[i + 1], sampleRate)
        : (totalDurationMs / 1000);
      const endMs = Math.round(nextStartSec * 1000);

      return {
        index: i,
        filename: fileName,
        title: ch.title || `Chapter ${i + 1}`,
        startMs,
        endMs,
        durationMs: endMs - startMs,
      };
    });
  } else {
    chapters = [{
      index: 0,
      filename: fileName,
      title: bookName,
      startMs: 0,
      endMs: Math.round(totalDurationMs),
      durationMs: Math.round(totalDurationMs),
    }];
  }

  const fileInfos: FileInfo[] = [{ name: fileName, size: fileStat.size }];
  const checksum = computeChecksum(fileInfos);

  return {
    name: bookName,
    checksum,
    chapters,
    folderPath: folder,
  };
}

let currentBlobUrl: string | null = null;
let currentBlobFile: string | null = null;

export class FileNotFoundError extends Error {
  constructor(path: string) {
    super(`Audiobook files not found — folder may have been moved or deleted.\n${path}`);
    this.name = "FileNotFoundError";
  }
}

export async function loadAudioFileAsBlob(
  folderPath: string,
  filename: string
): Promise<string> {
  const fullPath = joinPath(folderPath, filename);

  if (currentBlobUrl && currentBlobFile === fullPath) {
    return currentBlobUrl;
  }

  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
    currentBlobFile = null;
  }

  const pathExists = await checkPathExists(fullPath);
  if (!pathExists) {
    throw new FileNotFoundError(fullPath);
  }

  const contents = await readFile(fullPath);
  const ext = filename.split(".").pop()?.toLowerCase() || "mp3";
  const mime = MIME_TYPES[ext] || "audio/mpeg";
  const blob = new Blob([contents], { type: mime });
  currentBlobUrl = URL.createObjectURL(blob);
  currentBlobFile = fullPath;
  return currentBlobUrl;
}

export function revokeCurrentAudioBlob() {
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
    currentBlobFile = null;
  }
}

const coverArtCache = new Map<string, string | null>();

export async function extractCoverArt(
  folderPath: string,
  chapters: ChapterInfo[]
): Promise<string | null> {
  const cacheKey = folderPath;
  if (coverArtCache.has(cacheKey)) return coverArtCache.get(cacheKey)!;

  const seen = new Set<string>();
  for (const chapter of chapters) {
    if (seen.has(chapter.filename)) continue;
    seen.add(chapter.filename);

    try {
      const ext = chapter.filename.split(".").pop()?.toLowerCase();
      if (ext !== "mp3" && ext !== "m4a" && ext !== "m4b") continue;

      const fullPath = joinPath(folderPath, chapter.filename);
      const headerSize = 512 * 1024;
      const data = await readFile(fullPath);
      const buf = data.length > headerSize ? data.slice(0, headerSize) : data;

      const { parseBuffer } = await import("music-metadata");
      const metadata = await parseBuffer(buf, {
        mimeType: MIME_TYPES[ext!] || "audio/mpeg",
        size: data.length,
      });

      const pic = metadata.common.picture?.[0];
      if (pic) {
        const blob = new Blob([new Uint8Array(pic.data)], { type: pic.format });
        const url = URL.createObjectURL(blob);
        coverArtCache.set(cacheKey, url);
        return url;
      }
    } catch {
      // try next chapter
    }
  }

  coverArtCache.set(cacheKey, null);
  return null;
}

export function clearCoverArtCache() {
  for (const url of coverArtCache.values()) {
    if (url) URL.revokeObjectURL(url);
  }
  coverArtCache.clear();
}
