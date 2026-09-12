// @vitest-environment node
import { expect, test } from "vitest";
import { fromBuffer } from "strtok3/core";
import { readMp4ChapterList } from "./mp4-chapters";

function box(type: string, payload: Buffer) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + 8);
  header.write(type, 4);
  return Buffer.concat([header, payload]);
}

function chapterList(version = 1) {
  const header = Buffer.alloc(version ? 9 : 5);
  header[0] = version;
  header[header.length - 1] = 2;
  const entries = [
    { title: "Opening", time: 0n },
    { title: "第二章", time: 600000000n },
  ].map(({ title, time }) => {
    const text = Buffer.from(title);
    const entry = Buffer.alloc(9);
    entry.writeBigUInt64BE(time);
    entry[8] = text.length;
    return Buffer.concat([entry, text]);
  });
  return box("chpl", Buffer.concat([header, ...entries]));
}

test.each([0, 1])(
  "reads version %i chapter times and UTF-8 titles",
  async (version) => {
    const data = box("moov", box("udta", chapterList(version)));
    expect(await readMp4ChapterList(fromBuffer(data))).toEqual([
      { title: "Opening", startMs: 0 },
      { title: "第二章", startMs: 60000 },
    ]);
  },
);

test("finds metadata after a five-gigabyte audio atom without reading its payload", async () => {
  const audioSize = 5_000_000_000;
  const header = Buffer.alloc(16);
  header.writeUInt32BE(1);
  header.write("mdat", 4);
  header.writeBigUInt64BE(BigInt(audioSize), 8);
  const metadata = box("moov", box("udta", chapterList()));
  const tokenizer = fromBuffer(Buffer.alloc(0));
  tokenizer.fileInfo.size = audioSize + metadata.length;
  let bytesRead = 0;
  tokenizer.peekBuffer = async (buffer, options) => {
    const position = options?.position ?? 0;
    const source = position < 16 ? header : metadata;
    const offset = position < 16 ? position : position - audioSize;
    expect(offset).toBeGreaterThanOrEqual(0);
    expect(offset + buffer.length).toBeLessThanOrEqual(source.length);
    buffer.set(source.subarray(offset, offset + buffer.length));
    bytesRead += buffer.length;
    return buffer.length;
  };
  expect(await readMp4ChapterList(tokenizer)).toHaveLength(2);
  expect(bytesRead).toBeLessThan(200);
  expect(tokenizer.position).toBe(0);
});

test("ignores truncated chapter lists and invalid atom sizes", async () => {
  const malformed = chapterList().subarray(0, -1);
  malformed.writeUInt32BE(malformed.length);
  expect(
    await readMp4ChapterList(fromBuffer(box("moov", box("udta", malformed)))),
  ).toEqual([]);
  const invalid = Buffer.from([0, 0, 0, 4, 109, 111, 111, 118]);
  expect(await readMp4ChapterList(fromBuffer(invalid))).toEqual([]);
});
