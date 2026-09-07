import { expect, test } from "vitest";
import { fingerprintFile, recordingFingerprint } from "./fingerprint";

test("hashes bytes with bounded reads and detects incomplete imports", async () => {
  const abc = new TextEncoder().encode("abc");
  expect(await fingerprintFile(3, async () => abc)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  await expect(fingerprintFile(4, async () => abc)).rejects.toThrow("File changed");
  const sizes: number[] = [];
  await fingerprintFile(3 * 1024 * 1024 + 2, async (_, length) => { sizes.push(length); return new Uint8Array(length); });
  expect(sizes).toEqual([1048576, 1048576, 1048576, 2]);
});

test("recording identity preserves file order and excludes filenames", () => {
  const a = "a".repeat(64), b = "b".repeat(64);
  expect(recordingFingerprint([a, b])).not.toBe(recordingFingerprint([b, a]));
  expect(() => recordingFingerprint([])).toThrow();
});
