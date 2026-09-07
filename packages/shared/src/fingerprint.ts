import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

/** Order is part of the timeline; display names are deliberately excluded. */
export function recordingFingerprint(fileHashes: string[]): string {
  if (!fileHashes.length || fileHashes.some((h) => !/^[a-f0-9]{64}$/.test(h))) throw new Error("Invalid SHA-256 file fingerprints");
  return `sha256-v1:${bytesToHex(sha256(utf8ToBytes(fileHashes.join("\n"))))}`;
}

export async function fingerprintFile(size: number, read: (offset: number, length: number) => Promise<Uint8Array>): Promise<string> {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error("Invalid file size");
  const hash = sha256.create();
  for (let offset = 0; offset < size;) {
    const length = Math.min(1024 * 1024, size - offset);
    const chunk = await read(offset, length);
    if (chunk.length !== length) throw new Error("File changed or could not be read during import");
    hash.update(chunk);
    offset += length;
  }
  return bytesToHex(hash.digest());
}
