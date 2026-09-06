import type {
  PlaybackPosition,
  SyncState,
  SyncStatus,
  StorageAdapter,
  SyncPushFn,
  OnRemoteNewerFn,
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
  private onRemoteNewer: OnRemoteNewerFn | null = null;
  private audiobookId: string;

  private remoteSyncTimer: ReturnType<typeof setInterval> | null = null;
  private localPersistTimer: ReturnType<typeof setInterval> | null = null;
  private listeners: Set<(state: SyncState) => void> = new Set();
  private isPlaying = false;
  private initialization: Promise<PlaybackPosition | null> | null = null;
  private persistence: Promise<void> = Promise.resolve();
  private syncing: Promise<void> | null = null;
  private syncRequested = false;

  constructor(
    audiobookId: string,
    storage: StorageAdapter,
    pushFn: SyncPushFn,
    onRemoteNewer?: OnRemoteNewerFn
  ) {
    this.audiobookId = audiobookId;
    this.storage = storage;
    this.pushFn = pushFn;
    this.onRemoteNewer = onRemoteNewer ?? null;
  }

  subscribe(listener: (state: SyncState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  getState(): SyncState {
    return { ...this.state };
  }

  setPushFn(pushFn: SyncPushFn) {
    this.pushFn = pushFn;
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

  initialize(): Promise<PlaybackPosition | null> {
    this.initialization ??= this.loadLocalPosition();
    return this.initialization;
  }

  private async loadLocalPosition(): Promise<PlaybackPosition | null> {
    const stored = await this.storage.getItem(
      STORAGE_KEY_PREFIX + this.audiobookId
    );
    if (stored) {
      try {
        const position = JSON.parse(stored) as PlaybackPosition;
        position.audiobookId = this.audiobookId;
        if (!Number.isFinite(position.updatedAt)) position.updatedAt = 0;
        if (!Number.isInteger(position.chapterIndex) || position.chapterIndex < 0 ||
            !Number.isFinite(position.positionMs) || position.positionMs < 0) return null;
        this.reconcilePosition(position);
        return this.state.pending;
      } catch {
        // corrupted data
      }
    }
    return null;
  }

  /** Select a resume position without making old progress look newly edited. */
  reconcilePosition(remote: Omit<PlaybackPosition, "audiobookId"> | null): PlaybackPosition | null {
    if (remote && (!this.state.pending || remote.updatedAt > this.state.pending.updatedAt)) {
      this.state.pending = { ...remote, audiobookId: this.audiobookId };
      void this.persistLocally();
    }
    return this.state.pending;
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
    if (this.state.pending?.chapterIndex === chapterIndex &&
        this.state.pending.positionMs === positionMs) return;
    this.state.pending = {
      audiobookId: this.audiobookId,
      chapterIndex,
      positionMs,
      updatedAt: Date.now(),
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
    this.isPlaying = false;
    this.stopTimers();
    await this.persistLocally();
    await this.syncToRemote();
  }

  async onReconnect() {
    await this.syncToRemote();
  }

  async manualSync() {
    await this.persistLocally();
    await this.syncToRemote();
  }

  private persistLocally(): Promise<void> {
    if (!this.state.pending) return Promise.resolve();
    const value = JSON.stringify(this.state.pending);
    this.persistence = this.persistence.then(() => this.storage.setItem(
      STORAGE_KEY_PREFIX + this.audiobookId, value,
    )).catch((error: unknown) => {
      this.setStatus("error", error instanceof Error ? error.message : "Local save failed");
    });
    return this.persistence;
  }

  private syncToRemote(): Promise<void> {
    this.syncRequested = true;
    if (this.syncing) return this.syncing;
    this.syncing = this.flushRequestedPositions().finally(() => { this.syncing = null; });
    return this.syncing;
  }

  private async flushRequestedPositions() {
    while (this.syncRequested) {
      this.syncRequested = false;
      await this.pushPosition();
    }
  }

  private async pushPosition() {
    const sent = this.state.pending;
    if (!sent) return;

    this.setStatus("syncing");

    try {
      const result = await this.pushFn(sent);

      if (result.accepted) {
        this.setStatus("synced");
        await this.persistLocally();
      } else if (result.serverPosition) {
        this.setStatus("synced");
        if (!this.isPlaying && this.state.pending === sent) {
          this.state.pending = {
            audiobookId: this.audiobookId,
            chapterIndex: result.serverPosition.chapterIndex,
            positionMs: result.serverPosition.positionMs,
            updatedAt: result.serverPosition.updatedAt,
          };
          this.onRemoteNewer?.({
            chapterIndex: result.serverPosition.chapterIndex,
            positionMs: result.serverPosition.positionMs,
          });
        }
        await this.persistLocally();
      }
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
