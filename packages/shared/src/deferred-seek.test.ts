import { expect, test, vi } from "vitest";
import { DeferredSeek } from "./deferred-seek";

test("a remote seek waits for a mounted player and propagates native failure", async () => {
  const gate = new DeferredSeek();
  const done = vi.fn();
  const seeking = gate.seek({ chapterIndex: 2, positionMs: 9000 });
  void seeking.then(done, () => {});
  await Promise.resolve();
  expect(done).not.toHaveBeenCalled();
  const seek = vi.fn(async () => {
    throw new Error("Missing chapter");
  });
  gate.attach(seek);
  await expect(seeking).rejects.toThrow("Missing chapter");
  expect(seek).toHaveBeenCalledWith(2, 9000);
});
