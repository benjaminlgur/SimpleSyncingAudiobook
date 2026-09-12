type Position = { chapterIndex: number; positionMs: number };
type Seek = (chapter: number, ms: number) => Promise<void>;

/** Remote adoption must await a real player, including during first render. */
export class DeferredSeek {
  private player: Seek | null = null;
  private pending: {
    position: Position;
    resolve: () => void;
    reject: (error: Error) => void;
  } | null = null;

  seek(position: Position): Promise<void> {
    if (this.player)
      return this.player(position.chapterIndex, position.positionMs);
    this.pending?.resolve();
    return new Promise((resolve, reject) => {
      this.pending = { position, resolve, reject };
    });
  }

  attach(player: Seek) {
    this.player = player;
    const pending = this.pending;
    this.pending = null;
    if (pending)
      void player(
        pending.position.chapterIndex,
        pending.position.positionMs,
      ).then(pending.resolve, pending.reject);
    return () => {
      if (this.player === player) this.player = null;
    };
  }

  cancel() {
    this.player = null;
    this.pending?.reject(
      new Error("Playback closed before restoring the saved position"),
    );
    this.pending = null;
  }
}
