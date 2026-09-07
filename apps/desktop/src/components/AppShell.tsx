import { CloudContext } from "@audiobook/shared/react";
import { useState, useEffect, useCallback, useMemo, useContext } from "react";
import { useConvex } from "convex/react";
import { Library } from "./Library";
import { Player } from "./Player";
import { Settings } from "./Settings";
import type { AudiobookMeta } from "@audiobook/shared";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { checkPathExists } from "../lib/tauri-fs";
import { useConnectionMode } from "../App";
import { getScopedStorageKey, getStorageScope } from "../lib/storageScope";

interface AppShellProps {
  convexUrl: string;
  userScope?: string;
  onDisconnect: () => void;
}

export interface LocalAudiobook extends AudiobookMeta {
  convexId?: string;
  missing?: boolean;
}

const LIBRARY_KEY = "audiobook_library";
const DEVICE_ID_KEY = "audiobook_device_id";

function readLibraryFromStorage(storageKey: string): LocalAudiobook[] {
  try {
    const stored = localStorage.getItem(storageKey);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function decodeUriValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getHostedScopeMigrationMatch(scope: string): {
  keyPrefix: string;
  userMarker: string;
} | null {
  if (!scope.startsWith("hosted:")) {
    return null;
  }

  const [, encodedUrl, encodedUserId] = scope.split(":");
  if (!encodedUrl || !encodedUserId) {
    return null;
  }

  const userId = decodeUriValue(encodedUserId);
  return {
    keyPrefix: `hosted:${encodedUrl}:`,
    userMarker: `%7C${userId}%7C`,
  };
}

function findLegacyHostedScopedKey(baseKey: string, scope: string): string | null {
  const match = getHostedScopeMigrationMatch(scope);
  if (!match) {
    return null;
  }

  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (
      key &&
      key.startsWith(`${baseKey}:${match.keyPrefix}`) &&
      key.includes(match.userMarker)
    ) {
      return key;
    }
  }

  return null;
}

function loadLibrary(
  storageKey: string,
  storageScope: string,
  legacyKey?: string
): LocalAudiobook[] {
  const stored = localStorage.getItem(storageKey);
  if (stored !== null) {
    return readLibraryFromStorage(storageKey);
  }

  const legacyHostedKey = findLegacyHostedScopedKey(LIBRARY_KEY, storageScope);
  if (legacyHostedKey) {
    const hostedBooks = readLibraryFromStorage(legacyHostedKey);
    if (hostedBooks.length > 0) {
      saveLibrary(storageKey, hostedBooks);
    }
    return hostedBooks;
  }

  if (!legacyKey) {
    return [];
  }

  const legacyStored = localStorage.getItem(legacyKey);
  if (legacyStored === null) {
    return [];
  }

  const legacyBooks = readLibraryFromStorage(legacyKey);
  if (legacyBooks.length > 0) {
    saveLibrary(storageKey, legacyBooks);
  }
  return legacyBooks;
}

function saveLibrary(storageKey: string, books: LocalAudiobook[]) {
  const toSave = books.map(({ missing: _, ...rest }) => rest);
  localStorage.setItem(storageKey, JSON.stringify(toSave));
}

function isInvalidAudiobookIdError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("ArgumentValidationError") ||
    error.message.includes('v.id("audiobooks")') ||
    error.message.includes("does not match validator")
  );
}

function getOrCreateDeviceId(
  storageKey: string,
  storageScope: string,
  legacyKey?: string
) {
  const existing = localStorage.getItem(storageKey);
  if (existing) return existing;

  const legacyHostedKey = findLegacyHostedScopedKey(DEVICE_ID_KEY, storageScope);
  if (legacyHostedKey) {
    const legacyHostedDeviceId = localStorage.getItem(legacyHostedKey);
    if (legacyHostedDeviceId) {
      localStorage.setItem(storageKey, legacyHostedDeviceId);
      return legacyHostedDeviceId;
    }
  }

  if (legacyKey) {
    const legacy = localStorage.getItem(legacyKey);
    if (legacy) {
      localStorage.setItem(storageKey, legacy);
      return legacy;
    }
  }

  const next = `desktop_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  localStorage.setItem(storageKey, next);
  return next;
}

export function AppShell({ convexUrl, onDisconnect, userScope }: AppShellProps) {
  const convex = useConvex();
  const mode = useConnectionMode();
  const { ready: cloudReady, syncKey } = useContext(CloudContext);
  const storageScope = useMemo(
    () =>
      getStorageScope({
        mode,
        convexUrl,
        userScope: mode === "hosted" ? userScope ?? null : null,
      }),
    [convexUrl, mode, userScope]
  );
  const libraryStorageKey = useMemo(
    () =>
      storageScope ? getScopedStorageKey(LIBRARY_KEY, storageScope) : null,
    [storageScope]
  );
  const deviceStorageKey = useMemo(
    () =>
      storageScope ? getScopedStorageKey(DEVICE_ID_KEY, storageScope) : null,
    [storageScope]
  );
  const legacyLibraryKey = mode === "self-hosted" ? LIBRARY_KEY : undefined;
  const legacyDeviceKey = mode === "self-hosted" ? DEVICE_ID_KEY : undefined;
  const [library, setLibrary] = useState<LocalAudiobook[]>([]);
  const [activeBook, setActiveBook] = useState<LocalAudiobook | null>(null);
  const [showPlayer, setShowPlayer] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [storageReady, setStorageReady] = useState(false);

  useEffect(() => {
    if (!libraryStorageKey || !deviceStorageKey || !storageScope) {
      setLibrary([]);
      setActiveBook(null);
      setDeviceId(null);
      setStorageReady(false);
      return;
    }

    let cancelled = false;
    setStorageReady(false);
    setActiveBook(null);
    setDeviceId(getOrCreateDeviceId(deviceStorageKey, storageScope, legacyDeviceKey));

    const storedBooks = loadLibrary(
      libraryStorageKey,
      storageScope,
      legacyLibraryKey
    );

    setLibrary(storedBooks);
    setStorageReady(true);
    void (async () => {
      const validated = await Promise.all(
        storedBooks.map(async (book) => {
          const pathExists = await checkPathExists(book.folderPath);
          return { ...book, missing: !pathExists };
        })
      );

      if (cancelled) return;
      setLibrary(validated);
      setStorageReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    deviceStorageKey,
    legacyDeviceKey,
    legacyLibraryKey,
    libraryStorageKey,
    storageScope,
  ]);

  useEffect(() => {
    let cancelled = false;

    const pruneBooksMissingInDatabase = async () => {
      if (!cloudReady || library.length === 0) return;

      const booksWithConvexId = library.filter((book) => !!book.convexId);
      if (booksWithConvexId.length === 0) return;

      const missingKeys = new Set<string>();
      const invalidIdKeys = new Set<string>();

      await Promise.all(
        booksWithConvexId.map(async (book) => {
          try {
            const doc = await convex.query(api.audiobooks.get, {
              syncKey,
              id: book.convexId as Id<"audiobooks">,
            });
            if (!doc) {
              missingKeys.add(`${book.name}::${book.checksum}`);
            }
          } catch (error) {
            if (isInvalidAudiobookIdError(error)) {
              invalidIdKeys.add(`${book.name}::${book.checksum}`);
            }
          }
        })
      );

      if ((missingKeys.size === 0 && invalidIdKeys.size === 0) || cancelled) return;

      const updated = library
        .map((book) =>
          (missingKeys.has(`${book.name}::${book.checksum}`) || invalidIdKeys.has(`${book.name}::${book.checksum}`))
            ? { ...book, convexId: undefined }
            : book
        );
      setLibrary(updated);
      if (libraryStorageKey) {
        saveLibrary(libraryStorageKey, updated);
      }

      if (
        activeBook &&
        missingKeys.has(`${activeBook.name}::${activeBook.checksum}`)
      ) {
        setActiveBook({ ...activeBook, convexId: undefined });
      }
    };

    void pruneBooksMissingInDatabase();
    return () => {
      cancelled = true;
    };
  }, [activeBook, convex, library, libraryStorageKey, cloudReady, syncKey]);

  const persistLibrary = useCallback(
    (books: LocalAudiobook[]) => {
      setLibrary(books);
      if (libraryStorageKey) {
        saveLibrary(libraryStorageKey, books);
      }
    },
    [libraryStorageKey]
  );

  const addBook = (book: LocalAudiobook) => {
    const existing = library.find(
      (b) => b.name === book.name && b.checksum === book.checksum
    );
    if (existing) {
      setActiveBook({ ...existing, missing: false });
      setShowPlayer(true);
      return;
    }
    const updated = [...library, { ...book, missing: false }];
    persistLibrary(updated);
  };

  const updateBookConvexId = (book: LocalAudiobook, convexId: string) => {
    const updated = library.map((b) =>
      b.name === book.name && b.checksum === book.checksum
        ? { ...b, convexId }
        : b
    );
    persistLibrary(updated);
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
    persistLibrary(updated);
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
    persistLibrary(updated);
    if (
      activeBook &&
      activeBook.name === book.name &&
      activeBook.checksum === book.checksum
    ) {
      setActiveBook(null);
    }
  };

  if (!storageReady || !deviceId || !storageScope) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground text-sm">
          Loading library...
        </div>
      </div>
    );
  }

  return (
    <>
      {activeBook && <div hidden={!showPlayer}>
        <Player
          key={`${storageScope}:${activeBook.name}:${activeBook.checksum}`}
          book={activeBook}
          convexUrl={convexUrl}
          storageScope={storageScope}
          onBack={() => setShowPlayer(false)}
          onConvexIdResolved={(id) => updateBookConvexId(activeBook, id)}
          onRelocate={(newPath) => relocateBook(activeBook, newPath)}
        />
      </div>}
      {(!activeBook || !showPlayer) && <>
        {activeBook && <button className="w-full p-3 bg-card border-b border-border text-primary text-sm" onClick={() => setShowPlayer(true)}>Return to {activeBook.name}</button>}
        {showSettings ? <Settings onBack={() => setShowSettings(false)} onDisconnect={onDisconnect} /> :
          <Library
            deviceId={deviceId}
            books={library}
            onAddBook={addBook}
            onBookConvexIdResolved={updateBookConvexId}
            onSelectBook={(book) => { setActiveBook(book); setShowPlayer(true); }}
            onRemoveBook={removeBook}
            onRelocateBook={relocateBook}
            onOpenSettings={() => setShowSettings(true)}
          />}
      </>}
    </>
  );
}
