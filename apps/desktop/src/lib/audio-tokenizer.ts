import { invoke } from "@tauri-apps/api/core";
import { AbstractTokenizer, EndOfStreamError, type IReadChunkOptions } from "strtok3/core";

/** Random access to native audio. No audio payload is buffered while skipping. */
export class AudioTokenizer extends AbstractTokenizer {
  private bytesRead = 0;
  constructor(readonly path: string, readonly fileInfo: { size: number; mimeType: string }, private readonly budget = 32 * 1024 * 1024) { super(); }
  supportsRandomAccess() { return true; }
  async peekBuffer(buffer: Uint8Array, options?: IReadChunkOptions) {
    const opts = this.normalizeOptions(buffer, options);
    const length = Math.min(opts.length, Math.max(0, this.fileInfo.size - opts.position));
    if (length > buffer.length || length < 0 || opts.position < 0 || this.bytesRead + length > this.budget) throw new Error("Audio metadata exceeds read budget");
    let read = 0;
    while (read < length) {
      const data = await invoke<number[]>("read_audio_range", { path: this.path, offset: opts.position + read, length: Math.min(1024 * 1024, length - read) });
      if (!data.length) break;
      buffer.set(data, read);
      read += data.length;
      this.bytesRead += data.length;
    }
    if (read < opts.length && !opts.mayBeLess) throw new EndOfStreamError();
    return read;
  }
  async readBuffer(buffer: Uint8Array, options?: IReadChunkOptions) {
    const position = options?.position ?? this.position;
    const read = await this.peekBuffer(buffer, options);
    this.position = position + read;
    return read;
  }
}
