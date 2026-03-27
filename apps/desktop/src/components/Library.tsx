import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { pickAudiobookFolder, scanAudiobookFolder } from "../lib/tauri-fs";
import type { LocalAudiobook } from "./AppShell";
import { LinkingDialog } from "./LinkingDialog";

interface LibraryProps {
  books: LocalAudiobook[];
  onAddBook: (book: LocalAudiobook) => void;
  onSelectBook: (book: LocalAudiobook) => void;
  onRemoveBook: (book: LocalAudiobook) => void;
  onDisconnect: () => void;
}

export function Library({
  books,
  onAddBook,
  onSelectBook,
  onRemoveBook,
  onDisconnect,
}: LibraryProps) {
  const [isScanning, setIsScanning] = useState(false);
  const [linkingBook, setLinkingBook] = useState<LocalAudiobook | null>(null);
  const getOrCreate = useMutation(api.audiobooks.getOrCreate);

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

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">Library</h1>
        <button
          onClick={onDisconnect}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Disconnect
        </button>
      </header>

      {/* Content */}
      <div className="flex-1 p-4 overflow-auto">
        {books.length === 0 ? (
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
                Add a folder containing your audiobook files
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            {books.map((book) => (
              <button
                key={`${book.name}-${book.checksum}`}
                onClick={() => onSelectBook(book)}
                className="group w-full text-left rounded-lg border border-border bg-card p-4 hover:border-primary/50 hover:shadow-sm transition-all"
              >
                <div className="flex items-center gap-3">
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
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {book.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {book.chapters.length} chapter
                      {book.chapters.length !== 1 ? "s" : ""}
                      {book.convexId ? (
                        <span className="ml-2 text-green-600">Synced</span>
                      ) : (
                        <span className="ml-2 text-yellow-600">Local only</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                    {book.convexId && (
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
                        onRemoveBook(book);
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
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Add button */}
      <div className="p-4 border-t border-border">
        <button
          onClick={handleAddFolder}
          disabled={isScanning}
          className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          {isScanning ? (
            <>
              <svg
                className="animate-spin h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Scanning...
            </>
          ) : (
            <>
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 4.5v15m7.5-7.5h-15"
                />
              </svg>
              Add Audiobook Folder
            </>
          )}
        </button>
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
