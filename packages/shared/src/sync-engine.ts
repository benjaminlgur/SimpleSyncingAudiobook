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
  private localSaveFailed = false;
  private syncing: Promise<void> | null = null;
  private syncRequested = false;
  private readonly sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  private sequence = 0;
  private applyingPosition = 0;
  private inFlight: PlaybackPosition | null = null;

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
    let stored: string | null;
    try { stored = await this.storage.getItem(STORAGE_KEY_PREFIX + this.audiobookId); }
    catch (error) { this.setStatus("error", error instanceof Error ? error.message : "Local restore failed"); return null; }
    if (stored) {
      try {
        const position = JSON.parse(stored) as PlaybackPosition;
        position.audiobookId = this.audiobookId;
        if (!Number.isFinite(position.updatedAt)) position.updatedAt = 0;
        if (!Number.isInteger(position.chapterIndex) || position.chapterIndex < 0 ||
            !Number.isFinite(position.positionMs) || position.positionMs < 0) return null;
        if (!this.state.pending || position.updatedAt > this.state.pending.updatedAt) {
          this.state.pending = position;
          const conflict = (JSON.parse(stored) as { conflict?: PlaybackPosition }).conflict;
          if (conflict && Number.isSafeInteger(conflict.revision) && Number.isFinite(conflict.positionMs)) this.setConflict(conflict);
        }
        this.notify();
        return this.state.pending;
      } catch {
        // corrupted data
      }
    }
    return null;
  }

  /** Select a resume position without making old progress look newly edited. */
  reconcilePosition(remote: Omit<PlaybackPosition, "audiobookId"> | null): PlaybackPosition | null {
    const local = this.state.pending;
    if (remote?.revision !== undefined) {
      if (local?.revision !== undefined && remote.revision < local.revision) return local;
      if (local && remote.operationId && (remote.operationId === local.operationId || remote.operationId === this.inFlight?.operationId)) {
        this.state.pending = { ...local, revision: remote.revision, dirty: local.operationId !== remote.operationId };
        void this.persistLocally();
        return this.state.pending;
      }
      if (local && (local.dirty !== false || this.isPlaying)) {
        // An unknown base cannot establish that local playback includes remote
        // progress, even for legacy revision zero. Listening updates timestamps
        // without observing the server, so never use them to authorize a write.
        if ((local.revision ?? -1) < remote.revision) {
          this.setConflict({ ...remote, audiobookId: this.audiobookId });
        } else {
          this.state.pending = { ...local, revision: remote.revision };
        }
      } else if (!local || remote.revision > (local.revision ?? -1)) {
        this.state.pending = { ...remote, audiobookId: this.audiobookId, dirty: false };
      }
    } else if (remote && (!local || remote.updatedAt > local.updatedAt)) {
      this.state.pending = { ...remote, audiobookId: this.audiobookId };
    }
    void this.persistLocally();
    if (this.state.pending !== local && this.state.pending?.dirty === false &&
        (!local || local.chapterIndex !== this.state.pending.chapterIndex || local.positionMs !== this.state.pending.positionMs)) {
      void this.applyToPlayer(this.state.pending);
    }
    return this.state.pending;
  }

  private setConflict(remote: PlaybackPosition) {
    this.state.conflict = remote;
    this.setStatus("error", "Another device changed this position. Choose which position to keep.");
    void this.persistLocally();
  }

  async resolveConflict(choice: "local" | "remote") {
    const remote = this.state.conflict;
    if (!remote || !this.state.pending) return;
    this.state.conflict = null;
    this.state.pending = choice === "remote"
      ? { ...remote, audiobookId: this.audiobookId, dirty: false }
      : { ...this.state.pending, revision: remote.revision, dirty: true,
          sessionId: this.sessionId, operationId: `${this.sessionId}:${++this.sequence}` };
    if (choice === "remote") await this.applyToPlayer(remote);
    this.setStatus(choice === "remote" ? "synced" : "idle");
    await this.persistLocally();
    if (choice === "local") await this.syncToRemote();
  }

  private async applyToPlayer(position: { chapterIndex: number; positionMs: number }) {
    this.applyingPosition++;
    try { const seeking = this.onRemoteNewer?.(position); if (seeking) await seeking; }
    catch (error) { this.setStatus("error", error instanceof Error ? error.message : "Unable to seek to saved position"); }
    finally { this.applyingPosition--; }
  }

  async restorePosition(chapterIndex: number, positionMs: number) {
    if (this.state.conflict) return;
    this.updatePosition(chapterIndex, positionMs);
    await this.applyToPlayer({ chapterIndex, positionMs });
    await this.manualSync();
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
    if (this.applyingPosition) return;
    if (!Number.isSafeInteger(chapterIndex) || chapterIndex < 0 || !Number.isFinite(positionMs) || positionMs < 0) return;
    if (this.state.pending?.chapterIndex === chapterIndex &&
        this.state.pending.positionMs === positionMs) return;
    this.state.pending = {
      audiobookId: this.audiobookId,
      chapterIndex,
      positionMs,
      updatedAt: Date.now(),
      revision: this.state.pending?.revision,
      dirty: true,
      sessionId: this.sessionId,
      operationId: `${this.sessionId}:${++this.sequence}`,
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
    const value = JSON.stringify({ ...this.state.pending, conflict: this.state.conflict ?? null });
    this.persistence = this.persistence.then(() => this.storage.setItem(
      STORAGE_KEY_PREFIX + this.audiobookId, value,
    )).then(() => { this.localSaveFailed = false; }).catch((error: unknown) => {
      this.localSaveFailed = true;
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
    let sent = this.state.pending;
    if (!sent || sent.dirty === false || this.state.conflict) return;

    if (!sent.operationId) {
      sent = { ...sent, operationId: `${this.sessionId}:${++this.sequence}`, sessionId: this.sessionId };
      this.state.pending = sent;
      await this.persistLocally();
    }
    await this.persistLocally();
    if (this.localSaveFailed) return;
    this.inFlight = sent;
    this.setStatus("syncing");

    try {
      const result = await this.pushFn(sent);

      if (result.accepted) {
        if (result.revision !== undefined && this.state.pending) {
          this.state.pending = { ...this.state.pending, revision: result.revision, dirty: this.state.pending.operationId !== sent.operationId };
        }
        this.setStatus("synced");
        await this.persistLocally();
      } else if (result.serverPosition?.revision !== undefined) {
        this.setConflict({ ...result.serverPosition, audiobookId: this.audiobookId });
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
    } finally {
      this.inFlight = null;
    }
  }

  destroy() {
    this.stopTimers();
    this.listeners.clear();
  }
}
