import type { IRandomAccessTokenizer } from "strtok3/core";

export interface Mp4Chapter {
  title: string;
  startMs: number;
}

/** Read the Nero chapter list without buffering mdat (the audiobook payload).
 * Format reference: FFmpeg libavformat/mov.c, mov_read_chpl.
 */
export async function readMp4ChapterList(
  tokenizer: IRandomAccessTokenizer,
): Promise<Mp4Chapter[]> {
  let atomsRead = 0;
  const read = async (position: number, length: number) => {
    const bytes = new Uint8Array(length);
    await tokenizer.peekBuffer(bytes, { position });
    return bytes;
  };
  const scan = async (
    start: number,
    end: number,
    depth: number,
  ): Promise<Mp4Chapter[]> => {
    for (let offset = start; offset + 8 <= end;) {
      if (++atomsRead > 4096) throw new Error("Too many MP4 metadata atoms");
      const header = await read(offset, 8);
      const view = new DataView(header.buffer);
      let size = view.getUint32(0);
      let headerSize = 8;
      if (size === 1) {
        if (offset + 16 > end) return [];
        size = Number(
          new DataView((await read(offset + 8, 8)).buffer).getBigUint64(0),
        );
        headerSize = 16;
      } else if (size === 0) size = end - offset;
      if (
        !Number.isSafeInteger(size) ||
        size < headerSize ||
        size > end - offset
      )
        return [];
      const type = String.fromCharCode(...header.subarray(4, 8));
      const payload = offset + headerSize;
      if (type === "chpl" && depth === 2) {
        // 255 entries, each with an eight-byte time and at most 255 title bytes.
        if (size - headerSize > 9 + 255 * 264) return [];
        return parseChapterList(await read(payload, size - headerSize));
      }
      if (
        (depth === 0 && type === "moov") ||
        (depth === 1 && type === "udta")
      ) {
        const chapters = await scan(payload, offset + size, depth + 1);
        if (chapters.length) return chapters;
      }
      offset += size;
    }
    return [];
  };
  return scan(0, tokenizer.fileInfo.size, 0);
}

function parseChapterList(bytes: Uint8Array): Mp4Chapter[] {
  if (bytes.length < 5) return [];
  let offset = bytes[0] === 0 ? 4 : 8;
  if (offset >= bytes.length) return [];
  const count = bytes[offset++];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chapters: Mp4Chapter[] = [];
  for (let index = 0; index < count; index++) {
    if (offset + 9 > bytes.length) return [];
    const startMs = Number(view.getBigUint64(offset) / 10000n);
    const length = bytes[offset + 8];
    offset += 9;
    if (
      offset + length > bytes.length ||
      !Number.isSafeInteger(startMs) ||
      (index > 0 && startMs <= chapters[index - 1].startMs)
    )
      return [];
    const title = new TextDecoder().decode(
      bytes.subarray(offset, offset + length),
    );
    chapters.push({ startMs, title: title || `Chapter ${index + 1}` });
    offset += length;
  }
  return chapters;
}
