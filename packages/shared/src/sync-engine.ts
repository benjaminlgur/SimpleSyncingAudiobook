import type {
  PlaybackPosition,
  SyncState,
  SyncStatus,
  StorageAdapter,
  SyncPushFn,
} from "./types";

const STORAGE_KEY_PREFIX = "audiobook_sync_";
const REMOTE_SYNC_INTERVAL_MS = 20_000;
const LOCAL_PERSIST_INTERVAL_MS = 2_000;

export class SyncEngine {
  private state: SyncState = {
    status: "idle",
    pending: null,
    lastSyncedAt: null,
    lastError: null,
  };

  private storage: StorageAdapter;
  private pushFn: SyncPushFn;
  private audiobookId: string;

  private remoteSyncTimer: ReturnType<typeof setInterval> | null = null;
  private localPersistTimer: ReturnType<typeof setInterval> | null = null;
  private listeners: Set<(state: SyncState) => void> = new Set();
  private isPlaying = false;

  constructor(
    audiobookId: string,
    storage: StorageAdapter,
    pushFn: SyncPushFn
  ) {
    this.audiobookId = audiobookId;
    this.storage = storage;
    this.pushFn = pushFn;
  }

  subscribe(listener: (state: SyncState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  getState(): SyncState {
    return { ...this.state };
  }

  private notify() {
    for (const listener of this.listeners) {
      listener({ ...this.state });
    }
  }

  private setStatus(status: SyncStatus, error?: string) {
    this.state.status = status;
    if (error !== undefined) this.state.lastError = error;
    if (status === "synced") {
      this.state.lastSyncedAt = Date.now();
      this.state.lastError = null;
    }
    this.notify();
  }

  async initialize(): Promise<PlaybackPosition | null> {
    const stored = await this.storage.getItem(
      STORAGE_KEY_PREFIX + this.audiobookId
    );
    if (stored) {
      try {
        const position = JSON.parse(stored) as PlaybackPosition;
        this.state.pending = position;
        return position;
      } catch {
        // corrupted data
      }
    }
    return null;
  }

  startTimers(playing: boolean) {
    this.isPlaying = playing;
    this.stopTimers();

    if (playing) {
      this.remoteSyncTimer = setInterval(() => {
        this.syncToRemote();
      }, REMOTE_SYNC_INTERVAL_MS);
    }

    this.localPersistTimer = setInterval(() => {
      this.persistLocally();
    }, LOCAL_PERSIST_INTERVAL_MS);
  }

  stopTimers() {
    if (this.remoteSyncTimer) {
      clearInterval(this.remoteSyncTimer);
      this.remoteSyncTimer = null;
    }
    if (this.localPersistTimer) {
      clearInterval(this.localPersistTimer);
      this.localPersistTimer = null;
    }
  }

  updatePosition(chapterIndex: number, positionMs: number) {
    this.state.pending = {
      audiobookId: this.audiobookId,
      chapterIndex,
      positionMs,
    };
  }

  async onPause() {
    this.isPlaying = false;
    this.stopTimers();
    this.startTimers(false);
    await this.persistLocally();
    await this.syncToRemote();
  }

  async onPlay() {
    this.isPlaying = true;
    this.stopTimers();
    this.startTimers(true);
  }

  async onChapterChange() {
    await this.persistLocally();
    await this.syncToRemote();
  }

  async onBackground() {
    await this.persistLocally();
    await this.syncToRemote();
  }

  async onClose() {
    this.stopTimers();
    await this.persistLocally();
    await this.syncToRemote();
  }

  async onReconnect() {
    await this.syncToRemote();
  }

  async manualSync() {
    await this.syncToRemote();
  }

  private async persistLocally() {
    if (!this.state.pending) return;
    await this.storage.setItem(
      STORAGE_KEY_PREFIX + this.audiobookId,
      JSON.stringify(this.state.pending)
    );
  }

  private async syncToRemote() {
    if (!this.state.pending) return;

    this.setStatus("syncing");

    try {
      await this.pushFn(this.state.pending);
      this.setStatus("synced");
      await this.storage.removeItem(STORAGE_KEY_PREFIX + this.audiobookId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sync failed";
      this.setStatus("error", message);
    }
  }

  destroy() {
    this.stopTimers();
    this.listeners.clear();
  }
}
