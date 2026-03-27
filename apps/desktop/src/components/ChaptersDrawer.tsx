import type { ChapterInfo } from "@audiobook/shared";

interface ChaptersDrawerProps {
  chapters: ChapterInfo[];
  currentIndex: number;
  onSelect: (index: number) => void;
  onClose: () => void;
}

export function ChaptersDrawer({
  chapters,
  currentIndex,
  onSelect,
  onClose,
}: ChaptersDrawerProps) {
  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="absolute bottom-0 left-0 right-0 bg-card border-t border-border rounded-t-xl max-h-[60vh] flex flex-col animate-in slide-in-from-bottom duration-200">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Chapters</h2>
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18 18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="overflow-auto flex-1 p-2">
          {chapters.map((chapter) => {
            const label =
              chapter.title ||
              chapter.filename?.replace(/\.[^/.]+$/, "") ||
              `Chapter ${chapter.index + 1}`;
            const isCurrent = chapter.index === currentIndex;

            return (
              <button
                key={chapter.index}
                onClick={() => onSelect(chapter.index)}
                className={`w-full text-left px-3 py-2.5 rounded-md text-sm transition-colors ${
                  isCurrent
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-foreground hover:bg-accent"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-6 text-right">
                    {chapter.index + 1}
                  </span>
                  <span className="truncate">{label}</span>
                  {isCurrent && (
                    <svg
                      className="ml-auto h-4 w-4 text-primary flex-shrink-0"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
