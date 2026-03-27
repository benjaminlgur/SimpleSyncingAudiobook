export interface ChapterInfo {
  index: number;
  filename: string;
  title?: string;
  durationMs?: number;
  startMs?: number;
  endMs?: number;
}

export interface AudiobookMeta {
  name: string;
  checksum: string;
  chapters: ChapterInfo[];
  folderPath: string;
}

export interface PlaybackPosition {
  audiobookId: string;
  chapterIndex: number;
  positionMs: number;
  updatedAt: number;
}

export type SyncStatus = "idle" | "synced" | "syncing" | "error";

export interface SyncState {
  status: SyncStatus;
  pending: PlaybackPosition | null;
  lastSyncedAt: number | null;
  lastError: string | null;
}

export interface PlayerState {
  isPlaying: boolean;
  currentChapterIndex: number;
  positionMs: number;
  durationMs: number;
  playbackSpeed: number;
}

export interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface SyncPushResult {
  accepted: boolean;
  serverPosition: { chapterIndex: number; positionMs: number; updatedAt: number } | null;
}

export type SyncPushFn = (position: PlaybackPosition) => Promise<SyncPushResult>;

export type OnRemoteNewerFn = (remote: { chapterIndex: number; positionMs: number }) => void;

export interface FileInfo {
  name: string;
  size: number;
}
