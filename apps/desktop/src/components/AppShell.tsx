import { useState } from "react";
import { Library } from "./Library";
import { Player } from "./Player";
import type { AudiobookMeta } from "@audiobook/shared";

interface AppShellProps {
  convexUrl: string;
  onDisconnect: () => void;
}

export interface LocalAudiobook extends AudiobookMeta {
  convexId?: string;
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
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(books));
}

export function AppShell({ convexUrl, onDisconnect }: AppShellProps) {
  const [library, setLibrary] = useState<LocalAudiobook[]>(loadLibrary);
  const [activeBook, setActiveBook] = useState<LocalAudiobook | null>(null);

  const addBook = (book: LocalAudiobook) => {
    const existing = library.find(
      (b) => b.name === book.name && b.checksum === book.checksum
    );
    if (existing) {
      setActiveBook(existing);
      return;
    }
    const updated = [...library, book];
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
      />
    );
  }

  return (
    <Library
      books={library}
      onAddBook={addBook}
      onSelectBook={setActiveBook}
      onRemoveBook={removeBook}
      onDisconnect={onDisconnect}
    />
  );
}
