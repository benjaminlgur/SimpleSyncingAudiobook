import { useState, useEffect, useCallback } from "react";
import { useConvex } from "convex/react";
import { Library } from "./Library";
import { Player } from "./Player";
import type { AudiobookMeta } from "@audiobook/shared";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
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
const DEVICE_ID_KEY = "audiobook_device_id";

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

function getOrCreateDeviceId() {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;

  const next = `desktop_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  localStorage.setItem(DEVICE_ID_KEY, next);
  return next;
}

export function AppShell({ convexUrl, onDisconnect }: AppShellProps) {
  const convex = useConvex();
  const [library, setLibrary] = useState<LocalAudiobook[]>(loadLibrary);
  const [activeBook, setActiveBook] = useState<LocalAudiobook | null>(null);
  const [deviceId] = useState<string>(getOrCreateDeviceId);

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

  useEffect(() => {
    let cancelled = false;

    const pruneBooksMissingInDatabase = async () => {
      if (library.length === 0) return;

      const booksWithConvexId = library.filter((book) => !!book.convexId);
      if (booksWithConvexId.length === 0) return;

      const missingKeys = new Set<string>();

      await Promise.all(
        booksWithConvexId.map(async (book) => {
          try {
            const doc = await convex.query(api.audiobooks.get, {
              id: book.convexId as Id<"audiobooks">,
            });
            if (!doc) {
              missingKeys.add(`${book.name}::${book.checksum}`);
            }
          } catch {
            // Keep local library as-is while offline or if request fails.
          }
        })
      );

      if (missingKeys.size === 0 || cancelled) return;

      const updated = library.filter(
        (book) => !missingKeys.has(`${book.name}::${book.checksum}`)
      );
      setLibrary(updated);
      saveLibrary(updated);

      if (
        activeBook &&
        missingKeys.has(`${activeBook.name}::${activeBook.checksum}`)
      ) {
        setActiveBook(null);
      }
    };

    void pruneBooksMissingInDatabase();
    return () => {
      cancelled = true;
    };
  }, [activeBook, convex, library]);

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
      deviceId={deviceId}
      books={library}
      onAddBook={addBook}
      onBookConvexIdResolved={updateBookConvexId}
      onSelectBook={setActiveBook}
      onRemoveBook={removeBook}
      onRelocateBook={relocateBook}
      onDisconnect={onDisconnect}
    />
  );
}
