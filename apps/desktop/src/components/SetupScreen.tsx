import { useState } from "react";

interface SetupScreenProps {
  onConnect: (url: string) => void;
}

export function SetupScreen({ onConnect }: SetupScreenProps) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();

    if (!trimmed) {
      setError("Please enter a Convex deployment URL");
      return;
    }

    if (
      !trimmed.startsWith("https://") ||
      !trimmed.includes(".convex.cloud")
    ) {
      setError(
        "URL should look like: https://your-project-123.convex.cloud"
      );
      return;
    }

    setError(null);
    onConnect(trimmed);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-2">
          <div className="text-5xl mb-4">
            <svg
              className="mx-auto h-16 w-16 text-primary"
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
          <h1 className="text-2xl font-bold text-foreground">
            Audiobook Player
          </h1>
          <p className="text-sm text-muted-foreground">
            Connect to your Convex deployment to sync your audiobook progress
            across devices.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="convex-url"
              className="text-sm font-medium text-foreground"
            >
              Convex Deployment URL
            </label>
            <input
              id="convex-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-project-123.convex.cloud"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <button
            type="submit"
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Connect
          </button>
        </form>

        <p className="text-xs text-center text-muted-foreground">
          Your Convex URL is stored locally on this device.
        </p>
      </div>
    </div>
  );
}
