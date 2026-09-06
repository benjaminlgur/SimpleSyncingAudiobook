import type { ChapterInfo } from "./types";

type Position = { chapterIndex: number; positionMs: number };

function isSingleFile(chapters: ChapterInfo[]) {
  return chapters.length > 0 && chapters.every((chapter) => chapter.filename === chapters[0].filename);
}

// Single-file books use an absolute offset on the wire, even on clients that
// cannot read embedded chapters. Older single-chapter imports already use this form.
export function toSyncPosition(chapters: ChapterInfo[], position: Position): Position {
  if (!isSingleFile(chapters)) return position;
  return { chapterIndex: 0, positionMs: (chapters[position.chapterIndex]?.startMs ?? 0) + position.positionMs };
}

export function fromSyncPosition(chapters: ChapterInfo[], position: Position): Position {
  if (!isSingleFile(chapters)) return position;
  const absoluteMs = position.positionMs;
  let chapterIndex = 0;
  for (let i = 0; i < chapters.length; i++) {
    if ((chapters[i].startMs ?? 0) <= absoluteMs) chapterIndex = i;
  }
  return { chapterIndex, positionMs: Math.max(0, absoluteMs - (chapters[chapterIndex]?.startMs ?? 0)) };
}
