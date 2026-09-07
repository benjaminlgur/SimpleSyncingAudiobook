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
  /** Last server revision observed by this device (absent on 0.x caches). */
  revision?: number;
  dirty?: boolean;
  operationId?: string;
  sessionId?: string;
}

export type SyncStatus = "idle" | "synced" | "syncing" | "error";

export interface SyncState {
  status: SyncStatus;
  pending: PlaybackPosition | null;
  lastSyncedAt: number | null;
  lastError: string | null;
  conflict?: PlaybackPosition | null;
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
  revision?: number;
  serverPosition: { chapterIndex: number; positionMs: number; updatedAt: number; revision?: number } | null;
}

export type SyncPushFn = (position: PlaybackPosition) => Promise<SyncPushResult>;

export type OnRemoteNewerFn = (remote: { chapterIndex: number; positionMs: number }) => void | Promise<void>;

export interface FileInfo {
  name: string;
  size: number;
}
