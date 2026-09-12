import type { AudiobookMeta } from "@audiobook/shared";
import {
  checkPathExists,
  pickAudiobookFile,
  pickAudiobookFolder,
} from "./tauri-fs";

export async function pickRelocatedBook(
  book: AudiobookMeta,
): Promise<string | null> {
  const singleFile =
    book.chapters.length > 0 &&
    book.chapters.every(
      (chapter) => chapter.filename === book.chapters[0].filename,
    );
  const selected = singleFile
    ? await pickAudiobookFile()
    : await pickAudiobookFolder();
  if (!selected) return null;
  const separator = Math.max(
    selected.lastIndexOf("/"),
    selected.lastIndexOf("\\"),
  );
  const directory = singleFile ? selected.slice(0, separator + 1) : selected;
  const pathSeparator = directory.includes("\\") ? "\\" : "/";
  for (const filename of new Set(
    book.chapters.map((chapter) => chapter.filename),
  )) {
    if (!(await checkPathExists(`${directory}${pathSeparator}${filename}`))) {
      throw new Error(
        `Could not find "${filename}" in the selected location. Please choose the folder containing all chapters.`,
      );
    }
  }
  return directory;
}
