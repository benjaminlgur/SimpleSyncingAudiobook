import * as FileSystem from "expo-file-system/legacy";

const HEADER_READ_BYTES = 1024 * 1024;
const MAX_ID3_READ_BYTES = 8 * 1024 * 1024;

const cache = new Map<string, string | null>();

function getExtension(uri: string): string {
  const withoutQuery = uri.split("?")[0] ?? uri;
  const base = withoutQuery.substring(withoutQuery.lastIndexOf("/") + 1);
  const extIdx = base.lastIndexOf(".");
  return extIdx >= 0 ? base.substring(extIdx + 1).toLowerCase() : "";
}

function decodeBase64(base64: string): Uint8Array {
  if (typeof atob === "function") {
    const binary = atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  }

  // Fallback for runtimes where atob is unavailable.
  if (typeof Buffer !== "undefined") {
    return Uint8Array.from(Buffer.from(base64, "base64"));
  }

  throw new Error("No base64 decoder available");
}

function encodeBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }

  // Fallback for runtimes where btoa is unavailable.
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  throw new Error("No base64 encoder available");
}

async function readBytes(
  uri: string,
  length: number,
  position = 0,
): Promise<Uint8Array> {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
    position,
    length,
  });
  return decodeBase64(base64);
}

function bytesToAscii(bytes: Uint8Array, start: number, len: number): string {
  let out = "";
  for (let i = 0; i < len; i += 1) {
    const idx = start + i;
    if (idx >= bytes.length) break;
    out += String.fromCharCode(bytes[idx] ?? 0);
  }
  return out;
}

function readUInt32BE(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) return 0;
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

function readSynchsafeUInt32(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) return 0;
  return (
    ((bytes[offset] ?? 0) << 21) |
    ((bytes[offset + 1] ?? 0) << 14) |
    ((bytes[offset + 2] ?? 0) << 7) |
    (bytes[offset + 3] ?? 0)
  );
}

function findNullTerminator(
  bytes: Uint8Array,
  offset: number,
  encoding: number,
): number {
  // 0/3 are single-byte encodings, 1/2 are UTF-16 variants.
  if (encoding === 1 || encoding === 2) {
    for (let i = offset; i + 1 < bytes.length; i += 2) {
      if ((bytes[i] ?? 0) === 0 && (bytes[i + 1] ?? 0) === 0) return i;
    }
    return bytes.length;
  }

  for (let i = offset; i < bytes.length; i += 1) {
    if ((bytes[i] ?? 0) === 0) return i;
  }
  return bytes.length;
}

function detectImageMime(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

function asDataUri(imageBytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${encodeBase64(imageBytes)}`;
}

function extractApicFrame(
  bytes: Uint8Array,
): { data: Uint8Array; mime: string } | null {
  if (bytes.length < 10 || bytesToAscii(bytes, 0, 3) !== "ID3") return null;

  const versionMajor = bytes[3] ?? 0;
  const tagSize = readSynchsafeUInt32(bytes, 6);
  const tagEnd = Math.min(bytes.length, 10 + tagSize);

  let cursor = 10;
  while (cursor + 10 <= tagEnd) {
    const frameId = bytesToAscii(bytes, cursor, 4);
    const frameSize =
      versionMajor === 4
        ? readSynchsafeUInt32(bytes, cursor + 4)
        : readUInt32BE(bytes, cursor + 4);

    if (!frameId.trim() || frameSize <= 0) break;
    const frameDataStart = cursor + 10;
    const frameDataEnd = frameDataStart + frameSize;
    if (frameDataEnd > tagEnd) break;

    if (frameId === "APIC") {
      const frame = bytes.subarray(frameDataStart, frameDataEnd);
      if (frame.length < 4) return null;

      const textEncoding = frame[0] ?? 0;
      const mimeEnd = findNullTerminator(frame, 1, 0);
      const mime = bytesToAscii(
        frame,
        1,
        Math.max(0, mimeEnd - 1),
      ).toLowerCase();

      const picTypeOffset = Math.min(frame.length, mimeEnd + 1);
      const descStart = Math.min(frame.length, picTypeOffset + 1);
      const descEnd = findNullTerminator(frame, descStart, textEncoding);
      const imageStart = Math.min(
        frame.length,
        descEnd + (textEncoding === 1 || textEncoding === 2 ? 2 : 1),
      );

      if (imageStart >= frame.length) return null;
      const imageData = frame.subarray(imageStart);
      const detectedMime = mime.startsWith("image/")
        ? mime
        : detectImageMime(imageData);
      if (!detectedMime) return null;

      return { data: imageData, mime: detectedMime };
    }

    cursor = frameDataEnd;
  }

  return null;
}

function findPngEnd(bytes: Uint8Array, offset: number): number {
  for (let i = offset + 8; i + 12 <= bytes.length;) {
    const chunkLength = readUInt32BE(bytes, i);
    const typeOffset = i + 4;
    const type = bytesToAscii(bytes, typeOffset, 4);
    const next = i + 12 + chunkLength;
    if (next > bytes.length) break;
    if (type === "IEND") return next;
    i = next;
  }
  return -1;
}

function findJpegEnd(bytes: Uint8Array, offset: number): number {
  for (let i = offset + 2; i + 1 < bytes.length; i += 1) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) return i + 2;
  }
  return -1;
}

function extractImageFromBuffer(
  bytes: Uint8Array,
): { data: Uint8Array; mime: string } | null {
  for (let i = 0; i + 8 < bytes.length; i += 1) {
    // PNG
    if (
      bytes[i] === 0x89 &&
      bytes[i + 1] === 0x50 &&
      bytes[i + 2] === 0x4e &&
      bytes[i + 3] === 0x47 &&
      bytes[i + 4] === 0x0d &&
      bytes[i + 5] === 0x0a &&
      bytes[i + 6] === 0x1a &&
      bytes[i + 7] === 0x0a
    ) {
      const end = findPngEnd(bytes, i);
      if (end > i) {
        return { data: bytes.subarray(i, end), mime: "image/png" };
      }
    }

    // JPEG
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff) {
      const end = findJpegEnd(bytes, i);
      if (end > i) {
        return { data: bytes.subarray(i, end), mime: "image/jpeg" };
      }
    }
  }

  return null;
}

async function extractFromUri(uri: string): Promise<string | null> {
  if (cache.has(uri)) return cache.get(uri) ?? null;

  try {
    const ext = getExtension(uri);

    if (ext === "mp3") {
      const header = await readBytes(uri, HEADER_READ_BYTES);
      const id3TagSize =
        header.length >= 10 && bytesToAscii(header, 0, 3) === "ID3"
          ? readSynchsafeUInt32(header, 6) + 10
          : 0;

      const desiredRead =
        id3TagSize > 0
          ? Math.min(
              MAX_ID3_READ_BYTES,
              Math.max(HEADER_READ_BYTES, id3TagSize),
            )
          : HEADER_READ_BYTES;
      const bytes =
        desiredRead > header.length
          ? await readBytes(uri, desiredRead)
          : header;

      const apic = extractApicFrame(bytes);
      if (apic) {
        const dataUri = asDataUri(apic.data, apic.mime);
        cache.set(uri, dataUri);
        return dataUri;
      }
    }

    // M4A/M4B (and fallback for other types): search for embedded image bytes
    // in the file header where container metadata is usually stored.
    const bytes = await readBytes(uri, HEADER_READ_BYTES);
    const image = extractImageFromBuffer(bytes);
    if (image) {
      const dataUri = asDataUri(image.data, image.mime);
      cache.set(uri, dataUri);
      return dataUri;
    }
  } catch {
    // Fall through to null; caller keeps placeholder artwork.
  }

  cache.set(uri, null);
  return null;
}

export async function extractCoverArtFromAudioUris(
  uris: string[],
): Promise<string | null> {
  const seen = new Set<string>();
  for (const uri of uris) {
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    const art = await extractFromUri(uri);
    if (art) return art;
  }
  return null;
}
