import type { FileInfo } from "./types";

/**
 * Compute a light fingerprint from sorted filenames and their sizes.
 * Deterministic across platforms for the same set of files.
 */
export function computeChecksum(files: FileInfo[]): string {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  const payload = sorted.map((f) => `${f.name}:${f.size}`).join("|");
  return simpleHash(payload);
}

function simpleHash(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const combined = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return combined.toString(36);
}
