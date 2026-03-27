export interface ChapterInfo {
  index: number;
  filename: string;
  durationMs?: number;
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

export type SyncPushFn = (position: PlaybackPosition) => Promise<void>;
export type SyncPullFn = (
  audiobookId: string
) => Promise<PlaybackPosition | null>;

export interface FileInfo {
  name: string;
  size: number;
}
