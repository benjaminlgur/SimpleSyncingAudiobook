import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

interface LinkingDialogProps {
  audiobookId: string;
  audiobookName: string;
  onClose: () => void;
  onLinksChanged?: () => void;
}

export function LinkingDialog({
  audiobookId,
  audiobookName,
  onClose,
  onLinksChanged,
}: LinkingDialogProps) {
  const [tab, setTab] = useState<"linked" | "available">("linked");

  const linkedBooks = useQuery(api.audiobooks.getLinked, {
    audiobookId: audiobookId as Id<"audiobooks">,
  });
  const nameMatches = useQuery(api.audiobooks.findByName, {
    name: audiobookName,
  });
  const linkMutation = useMutation(api.audiobooks.link);
  const unlinkMutation = useMutation(api.audiobooks.unlink);

  const availableToLink = (nameMatches || []).filter(
    (b) =>
      b._id !== audiobookId &&
      !(linkedBooks || []).some((lb) => lb._id === b._id)
  );

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 bg-card border border-border rounded-xl shadow-lg max-h-[70vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">
            Link Audiobook
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border">
          <button
            onClick={() => setTab("linked")}
            className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${
              tab === "linked"
                ? "text-primary border-b-2 border-primary"
                : "text-muted-foreground"
            }`}
          >
            Linked ({(linkedBooks || []).length})
          </button>
          <button
            onClick={() => setTab("available")}
            className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${
              tab === "available"
                ? "text-primary border-b-2 border-primary"
                : "text-muted-foreground"
            }`}
          >
            Available ({availableToLink.length})
          </button>
        </div>

        {/* Content */}
        <div className="overflow-auto flex-1 p-3">
          {tab === "linked" ? (
            (linkedBooks || []).length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">
                No linked audiobooks from other devices.
              </p>
            ) : (
              (linkedBooks || []).map((book) => (
                <div
                  key={book._id}
                  className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-accent"
                >
                  <div>
                    <p className="text-sm text-foreground">{book.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {book.chapters.length} chapters · {book.checksum.slice(0, 8)}
                    </p>
                  </div>
                  <button
                    onClick={async () => {
                      await unlinkMutation({
                        audiobookId: audiobookId as Id<"audiobooks">,
                        peerId: book._id,
                      });
                      onLinksChanged?.();
                    }}
                    className="text-xs text-destructive hover:underline"
                  >
                    Unlink
                  </button>
                </div>
              ))
            )
          ) : availableToLink.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">
              No other audiobooks with the name "{audiobookName}" found in Convex.
            </p>
          ) : (
            availableToLink.map((book) => (
              <div
                key={book._id}
                className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-accent"
              >
                <div>
                  <p className="text-sm text-foreground">{book.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {book.chapters.length} chapters · {book.checksum.slice(0, 8)}
                  </p>
                </div>
                <button
                  onClick={async () => {
                    await linkMutation({
                      canonicalId: audiobookId as Id<"audiobooks">,
                      linkedId: book._id,
                    });
                    onLinksChanged?.();
                  }}
                  className="text-xs text-primary hover:underline"
                >
                  Link
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
