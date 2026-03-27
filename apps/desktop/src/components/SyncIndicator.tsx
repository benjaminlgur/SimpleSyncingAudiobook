import type { SyncState } from "@audiobook/shared";

interface SyncIndicatorProps {
  syncState: SyncState;
  onManualSync: () => void;
}

export function SyncIndicator({ syncState, onManualSync }: SyncIndicatorProps) {
  const { status, lastError } = syncState;

  return (
    <button
      onClick={onManualSync}
      className="flex items-center gap-1.5 text-xs"
      title={lastError || statusLabel(status)}
    >
      <span className="relative flex h-2.5 w-2.5">
        {status === "syncing" && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
        )}
        <span
          className={`relative inline-flex rounded-full h-2.5 w-2.5 ${dotColor(status)}`}
        />
      </span>
      <span className="text-muted-foreground">{statusLabel(status)}</span>
    </button>
  );
}

function dotColor(status: SyncState["status"]): string {
  switch (status) {
    case "synced":
      return "bg-green-500";
    case "syncing":
      return "bg-blue-500";
    case "error":
      return "bg-orange-500";
    default:
      return "bg-gray-400";
  }
}

function statusLabel(status: SyncState["status"]): string {
  switch (status) {
    case "synced":
      return "Synced";
    case "syncing":
      return "Syncing...";
    case "error":
      return "Sync failed";
    default:
      return "Not synced";
  }
}
