import { useState, useEffect, useCallback } from "react";
import { Library } from "./Library";
import { Player } from "./Player";
import type { AudiobookMeta } from "@audiobook/shared";
import { checkPathExists } from "../lib/tauri-fs";

interface AppShellProps {
  convexUrl: string;
  onDisconnect: () => void;
}

export interface LocalAudiobook extends AudiobookMeta {
  convexId?: string;
  missing?: boolean;
}

const LIBRARY_KEY = "audiobook_library";

function loadLibrary(): LocalAudiobook[] {
  try {
    const stored = localStorage.getItem(LIBRARY_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveLibrary(books: LocalAudiobook[]) {
  const toSave = books.map(({ missing: _, ...rest }) => rest);
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(toSave));
}

export function AppShell({ convexUrl, onDisconnect }: AppShellProps) {
  const [library, setLibrary] = useState<LocalAudiobook[]>(loadLibrary);
  const [activeBook, setActiveBook] = useState<LocalAudiobook | null>(null);

  const validateLibraryPaths = useCallback(async (books: LocalAudiobook[]) => {
    const validated = await Promise.all(
      books.map(async (book) => {
        const pathExists = await checkPathExists(book.folderPath);
        return { ...book, missing: !pathExists };
      })
    );
    setLibrary(validated);
  }, []);

  useEffect(() => {
    validateLibraryPaths(loadLibrary());
  }, [validateLibraryPaths]);

  const addBook = (book: LocalAudiobook) => {
    const existing = library.find(
      (b) => b.name === book.name && b.checksum === book.checksum
    );
    if (existing) {
      setActiveBook({ ...existing, missing: false });
      return;
    }
    const updated = [...library, { ...book, missing: false }];
    setLibrary(updated);
    saveLibrary(updated);
  };

  const updateBookConvexId = (book: LocalAudiobook, convexId: string) => {
    const updated = library.map((b) =>
      b.name === book.name && b.checksum === book.checksum
        ? { ...b, convexId }
        : b
    );
    setLibrary(updated);
    saveLibrary(updated);
    if (
      activeBook &&
      activeBook.name === book.name &&
      activeBook.checksum === book.checksum
    ) {
      setActiveBook({ ...activeBook, convexId });
    }
  };

  const relocateBook = (book: LocalAudiobook, newFolderPath: string) => {
    const updated = library.map((b) =>
      b.name === book.name && b.checksum === book.checksum
        ? { ...b, folderPath: newFolderPath, missing: false }
        : b
    );
    setLibrary(updated);
    saveLibrary(updated);
    if (
      activeBook &&
      activeBook.name === book.name &&
      activeBook.checksum === book.checksum
    ) {
      setActiveBook({ ...activeBook, folderPath: newFolderPath, missing: false });
    }
  };

  const removeBook = (book: LocalAudiobook) => {
    const updated = library.filter(
      (b) => !(b.name === book.name && b.checksum === book.checksum)
    );
    setLibrary(updated);
    saveLibrary(updated);
    if (
      activeBook &&
      activeBook.name === book.name &&
      activeBook.checksum === book.checksum
    ) {
      setActiveBook(null);
    }
  };

  if (activeBook) {
    return (
      <Player
        book={activeBook}
        convexUrl={convexUrl}
        onBack={() => setActiveBook(null)}
        onConvexIdResolved={(id) => updateBookConvexId(activeBook, id)}
        onRelocate={(newPath) => relocateBook(activeBook, newPath)}
      />
    );
  }

  return (
    <Library
      books={library}
      onAddBook={addBook}
      onSelectBook={setActiveBook}
      onRemoveBook={removeBook}
      onRelocateBook={relocateBook}
      onDisconnect={onDisconnect}
    />
  );
}
