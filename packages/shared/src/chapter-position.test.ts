import { expect, test } from "vitest";
import { fromSyncPosition, toSyncPosition } from "./chapter-position";

test("M4B positions round-trip between clients with and without embedded chapters", () => {
  const desktop = [
    { index: 0, filename: "book.m4b", startMs: 0, endMs: 60000 },
    { index: 1, filename: "book.m4b", startMs: 60000, endMs: 120000 },
  ];
  const mobile = [{ index: 0, filename: "book.m4b", startMs: 0 }];
  const wire = toSyncPosition(desktop, { chapterIndex: 1, positionMs: 15000 });
  expect(fromSyncPosition(mobile, wire)).toEqual({ chapterIndex: 0, positionMs: 75000 });
  expect(fromSyncPosition(desktop, wire)).toEqual({ chapterIndex: 1, positionMs: 15000 });
});

test("separate-file chapters keep their original indices", () => {
  const chapters = [{ index: 0, filename: "1.mp3" }, { index: 1, filename: "2.mp3" }];
  expect(toSyncPosition(chapters, { chapterIndex: 1, positionMs: 1000 }))
    .toEqual({ chapterIndex: 1, positionMs: 1000 });
});
