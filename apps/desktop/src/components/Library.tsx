import { useState, useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { pickAudiobookFolder, pickAudiobookFile, scanAudiobookFolder, scanM4bFile, extractCoverArt, checkPathExists } from "../lib/tauri-fs";
import type { LocalAudiobook } from "./AppShell";
import { LinkingDialog } from "./LinkingDialog";

interface LibraryProps {
  deviceId: string;
  books: LocalAudiobook[];
  onAddBook: (book: LocalAudiobook) => void;
  onBookConvexIdResolved: (book: LocalAudiobook, convexId: string) => void;
  onSelectBook: (book: LocalAudiobook) => void;
  onRemoveBook: (book: LocalAudiobook) => void;
  onRelocateBook: (book: LocalAudiobook, newFolderPath: string) => void;
  onDisconnect: () => void;
}

function BookThumbnail({ book }: { book: LocalAudiobook }) {
  const [artUrl, setArtUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    extractCoverArt(book.folderPath, book.chapters).then((url) => {
      if (!cancelled) setArtUrl(url);
    });
    return () => { cancelled = true; };
  }, [book.folderPath, book.chapters]);

  if (artUrl) {
    return (
      <img
        src={artUrl}
        alt=""
        className="flex-shrink-0 w-12 h-12 rounded-md object-cover"
      />
    );
  }

  return (
    <div className="flex-shrink-0 w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center">
      <svg
        className="h-6 w-6 text-primary"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"
        />
      </svg>
    </div>
  );
}

export function Library({
  deviceId,
  books,
  onAddBook,
  onBookConvexIdResolved,
  onSelectBook,
  onRemoveBook,
  onRelocateBook,
  onDisconnect,
}: LibraryProps) {
  const [isScanning, setIsScanning] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [linkingBook, setLinkingBook] = useState<LocalAudiobook | null>(null);
  const getOrCreate = useMutation(api.audiobooks.getOrCreate);
  const registerOnDevice = useMutation(api.audiobooks.registerOnDevice);
  const removeFromDevice = useMutation(api.audiobooks.removeFromDevice);
  const removeFromDatabase = useMutation(api.audiobooks.remove);
  const remoteOnlyBooks = useQuery(
    api.audiobooks.listRemoteForDevice,
    deviceId ? { deviceId, refreshToken } : "skip"
  );
  const remoteOnlyCount = remoteOnlyBooks?.length ?? 0;

  useEffect(() => {
    let cancelled = false;

    const registerLocalBooks = async () => {
      if (!deviceId || books.length === 0) return;

      for (const book of books) {
        let audiobookId = book.convexId;

        if (!audiobookId) {
          try {
            const result = await getOrCreate({
              name: book.name,
              checksum: book.checksum,
              chapters: book.chapters,
            });
            audiobookId = result.audiobookId;
            if (cancelled) return;
            onBookConvexIdResolved(book, audiobookId);
          } catch {
            continue;
          }
        }

        try {
          await registerOnDevice({
            audiobookId: audiobookId as Id<"audiobooks">,
            deviceId,
            platform: "desktop",
          });
        } catch {
          // Best effort while offline.
        }
      }
    };

    void registerLocalBooks();
    return () => {
      cancelled = true;
    };
  }, [books, deviceId, getOrCreate, onBookConvexIdResolved, refreshToken, registerOnDevice]);

  const handleRemoveLocalBook = async (book: LocalAudiobook) => {
    if (deviceId && book.convexId) {
      try {
        await removeFromDevice({
          audiobookId: book.convexId as Id<"audiobooks">,
          deviceId,
        });
      } catch {
        // Keep local remove responsive if network is unavailable.
      }
    }

    onRemoveBook(book);
  };

  const handleRemoveRemoteFromDatabase = async (
    audiobookId: Id<"audiobooks">,
    name: string
  ) => {
    const confirmed = window.confirm(
      `Remove "${name}" from the shared database for all devices?`
    );
    if (!confirmed) return;

    try {
      await removeFromDatabase({ id: audiobookId });
    } catch {
      window.alert("Couldn't remove this audiobook from the database right now.");
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setRefreshToken((prev) => prev + 1);
    await new Promise((resolve) => setTimeout(resolve, 500));
    setIsRefreshing(false);
  };

  const handleRelocate = async (book: LocalAudiobook) => {
    const isM4b = book.chapters.length > 0 &&
      book.chapters[0].filename === book.chapters[book.chapters.length - 1].filename;

    let newPath: string | null;
    if (isM4b) {
      newPath = await pickAudiobookFile();
      if (newPath) {
        const sepIdx = Math.max(newPath.lastIndexOf("/"), newPath.lastIndexOf("\\"));
        newPath = sepIdx > 0 ? newPath.substring(0, sepIdx) : newPath;
      }
    } else {
      newPath = await pickAudiobookFolder();
    }

    if (!newPath) return;

    const firstFile = book.chapters[0]?.filename;
    if (firstFile) {
      const sep = newPath.includes("\\") ? "\\" : "/";
      const testPath = `${newPath}${sep}${firstFile}`;
      const found = await checkPathExists(testPath);
      if (!found) {
        alert(`Could not find "${firstFile}" in the selected location. Please choose the correct folder.`);
        return;
      }
    }

    onRelocateBook(book, newPath);
  };

  const handleAddFolder = async () => {
    setIsScanning(true);
    try {
      const folderPath = await pickAudiobookFolder();
      if (!folderPath) return;

      const meta = await scanAudiobookFolder(folderPath);
      if (!meta) {
        alert("No audio files found in the selected folder.");
        return;
      }

      let convexId: string | undefined;
      try {
        const result = await getOrCreate({
          name: meta.name,
          checksum: meta.checksum,
          chapters: meta.chapters,
        });
        convexId = result.audiobookId;
        await registerOnDevice({
          audiobookId: result.audiobookId,
          deviceId,
          platform: "desktop",
        });
      } catch {
        // Offline — will sync later
      }

      onAddBook({ ...meta, convexId });
    } catch (err) {
      console.error("Failed to scan folder:", err);
    } finally {
      setIsScanning(false);
    }
  };

  const handleAddFile = async () => {
    setIsScanning(true);
    try {
      const filePath = await pickAudiobookFile();
      if (!filePath) return;

      const meta = await scanM4bFile(filePath);
      if (!meta) {
        alert("Could not read the selected audiobook file.");
        return;
      }

      let convexId: string | undefined;
      try {
        const result = await getOrCreate({
          name: meta.name,
          checksum: meta.checksum,
          chapters: meta.chapters,
        });
        convexId = result.audiobookId;
        await registerOnDevice({
          audiobookId: result.audiobookId,
          deviceId,
          platform: "desktop",
        });
      } catch {
        // Offline — will sync later
      }

      onAddBook({ ...meta, convexId });
    } catch (err) {
      console.error("Failed to scan file:", err);
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">Library</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => void handleRefresh()}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
            aria-label="Refresh library"
          >
            <svg
              className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182"
              />
            </svg>
            Refresh
          </button>
          <button
            onClick={onDisconnect}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Disconnect
          </button>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 p-4 overflow-auto">
        {books.length === 0 && remoteOnlyCount === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-4 py-20">
            <svg
              className="h-16 w-16 text-muted-foreground/40"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"
              />
            </svg>
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                No audiobooks yet
              </p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Add a folder of audio files or an M4B audiobook
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            {books.map((book) => (
              <div
                key={`${book.name}-${book.checksum}`}
                role="button"
                tabIndex={0}
                onClick={() => !book.missing && onSelectBook(book)}
                onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !book.missing) onSelectBook(book); }}
                className={`group w-full text-left rounded-lg border p-4 transition-all ${
                  book.missing
                    ? "border-destructive/30 bg-destructive/5 cursor-default"
                    : "border-border bg-card hover:border-primary/50 hover:shadow-sm cursor-pointer"
                }`}
              >
                <div className="flex items-center gap-3">
                  {book.missing ? (
                    <div className="flex-shrink-0 w-12 h-12 rounded-md bg-destructive/10 flex items-center justify-center">
                      <svg className="h-6 w-6 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                      </svg>
                    </div>
                  ) : (
                    <BookThumbnail book={book} />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${book.missing ? "text-muted-foreground" : "text-foreground"}`}>
                      {book.name}
                    </p>
                    {book.missing ? (
                      <p className="text-xs text-destructive">
                        Files missing — folder moved or deleted
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {book.chapters.length} chapter
                        {book.chapters.length !== 1 ? "s" : ""}
                        {book.convexId ? (
                          <span className="ml-2 text-green-600">Synced</span>
                        ) : (
                          <span className="ml-2 text-yellow-600">Local only</span>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                    {book.missing && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRelocate(book);
                        }}
                        className="px-2.5 py-1 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                      >
                        Relocate
                      </button>
                    )}
                    {book.convexId && !book.missing && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setLinkingBook(book);
                        }}
                        className="p-1 text-muted-foreground hover:text-primary"
                        aria-label="Link audiobook"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m9.86-2.54a4.5 4.5 0 0 0-1.242-7.244l4.5-4.5a4.5 4.5 0 0 0 6.364 6.364l-1.757 1.757" />
                        </svg>
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleRemoveLocalBook(book);
                      }}
                      className="p-1 text-muted-foreground hover:text-destructive"
                      aria-label="Remove audiobook"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {remoteOnlyBooks && remoteOnlyBooks.length > 0 && (
          <div className="mt-6">
            <div className="flex items-center gap-1.5 mb-3">
              <svg className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z" />
              </svg>
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                On another device ({remoteOnlyBooks.length})
              </h2>
            </div>
            <div className="grid gap-3">
              {remoteOnlyBooks.map((book) => (
                <div
                  key={`remote-${book._id}`}
                  className="w-full text-left rounded-lg border border-indigo-200 bg-indigo-50/50 dark:border-indigo-900 dark:bg-indigo-950/30 p-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex-shrink-0 w-12 h-12 rounded-md bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center">
                      <svg className="h-6 w-6 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-muted-foreground truncate">
                        {book.name}
                      </p>
                      <p className="text-xs text-muted-foreground/70">
                        {book.chapters.length} chapter
                        {book.chapters.length !== 1 ? "s" : ""}
                        {" · "}Add local files to listen here
                      </p>
                    </div>
                    <button
                      onClick={() =>
                        void handleRemoveRemoteFromDatabase(book._id, book.name)
                      }
                      className="px-2.5 py-1 text-xs font-medium rounded-md border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors"
                      aria-label={`Remove ${book.name} from database`}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {remoteOnlyBooks === undefined && books.length === 0 && (
          <div className="text-center py-4">
            <p className="text-xs text-muted-foreground/60">
              Unable to check other devices right now
            </p>
          </div>
        )}
      </div>

      {/* Add buttons */}
      <div className="p-4 border-t border-border space-y-2">
        {isScanning ? (
          <div className="w-full rounded-md bg-primary/80 px-4 py-2.5 text-sm font-medium text-primary-foreground flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Scanning...
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={handleAddFolder}
              className="flex-1 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
              </svg>
              Add Folder
            </button>
            <button
              onClick={handleAddFile}
              className="flex-1 rounded-md border border-primary text-primary bg-transparent px-4 py-2.5 text-sm font-medium hover:bg-primary/10 transition-colors flex items-center justify-center gap-2"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
              </svg>
              Add M4B File
            </button>
          </div>
        )}
      </div>

      {linkingBook?.convexId && (
        <LinkingDialog
          audiobookId={linkingBook.convexId}
          audiobookName={linkingBook.name}
          onClose={() => setLinkingBook(null)}
        />
      )}
    </div>
  );
}
