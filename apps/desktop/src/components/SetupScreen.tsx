import { normalizeDeploymentUrl } from "@audiobook/shared";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import { useState } from "react";

interface SetupScreenProps {
  onSelfHostedConnect: (url: string, syncKey: string) => void | Promise<void>;
  onHostedConnect?: () => void;
}

export function SetupScreen({
  onSelfHostedConnect,
  onHostedConnect,
}: SetupScreenProps) {
  const [url, setUrl] = useState("");
  const [syncKey, setSyncKey] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setConnecting(true);
    setError(null);
    try {
      const endpoint = normalizeDeploymentUrl(url);
      const client = new ConvexHttpClient(endpoint);
      const result = await client.query(api.authState.checkConnection, { syncKey: syncKey.trim() || undefined });
      if (result.protocolVersion !== 1) throw new Error("Upgrade this deployment to version 1.0 first");
      await onSelfHostedConnect(endpoint, syncKey.trim());
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to connect. Check the URL, key, and server version.");
    } finally { setConnecting(false); }
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
            Simple Syncing Audiobook
          </h1>
          <p className="text-sm text-muted-foreground">
            Sync your audiobook progress across devices.
          </p>
        </div>

        <div className="space-y-6">
          {onHostedConnect && (
            <>
              <button
                onClick={onHostedConnect}
                className="w-full flex items-center justify-center gap-3 rounded-md border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground hover:bg-accent transition-colors"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
                Sign in with Google
              </button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">
                    or use your own deployment
                  </span>
                </div>
              </div>
            </>
          )}

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

            <label className="block text-sm text-foreground">Self-hosted access key
              <input type="password" autoComplete="off" value={syncKey} onChange={(e) => setSyncKey(e.target.value)} className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2" />
            </label>
            <button
              type="submit"
              disabled={connecting}
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              {connecting ? "Connecting..." : "Connect"}
            </button>
          </form>
        </div>

        <p className="text-xs text-center text-muted-foreground">
          {onHostedConnect
            ? "Sign in for free sync, or use your own Convex deployment for unlimited storage."
            : "Your Convex URL is stored locally on this device."}
        </p>
      </div>
    </div>
  );
}
