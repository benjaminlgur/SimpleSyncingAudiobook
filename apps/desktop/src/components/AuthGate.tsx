import { CloudProvider } from "@audiobook/shared/react";
import { api } from "../../../../convex/_generated/api";
import { useConvexAuth, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useEffect, useRef, useState } from "react";

interface AuthGateProps {
  children: (userScope: string) => React.ReactNode;
  convexUrl: string;
  onDisconnect: () => void;
}

export function AuthGate({ children, onDisconnect, convexUrl }: AuthGateProps) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signIn } = useAuthActions();
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handledCode = useRef(false);
  const cacheKey = `audiobook_account:${encodeURIComponent(convexUrl)}`;
  const [cachedScope, setCachedScope] = useState(() => localStorage.getItem(cacheKey));
  const viewerScope = useQuery(api.authState.viewerScope, isAuthenticated ? {} : "skip");
  useEffect(() => {
    if (viewerScope) { localStorage.setItem(cacheKey, viewerScope); setCachedScope(viewerScope); }
  }, [cacheKey, viewerScope]);

  useEffect(() => {
    if (isAuthenticated) {
      setSigningIn(false);
      setError(null);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (handledCode.current) return;

    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    if (!code) return;

    handledCode.current = true;
    setSigningIn(true);
    setError(null);

    url.searchParams.delete("code");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);

    const completeOAuthSignIn = signIn as unknown as (
      provider: string | undefined,
      params?: { code?: string },
    ) => Promise<{ signingIn: boolean; redirect?: URL }>;

    void completeOAuthSignIn(undefined, { code })
      .then(() => {
        setSigningIn(false);
      })
      .catch((e: unknown) => {
        const message =
          e instanceof Error && e.message
            ? e.message
            : "Sign-in failed while finishing the Google login flow.";
        setError(message);
        setSigningIn(false);
      });
  }, [signIn]);

  const handleSignIn = async () => {
    localStorage.removeItem(cacheKey);
    setCachedScope(null);
    setSigningIn(true);
    setError(null);
    try {
      const result = await signIn("google");
      if (result.signingIn) {
        const redirectUrl = result.redirect?.toString();
        if (redirectUrl) {
          window.location.href = redirectUrl;
        }
      } else if (!result.redirect) {
        setSigningIn(false);
      }
    } catch (e) {
      const message =
        e instanceof Error && e.message ? e.message : "Sign-in failed. Please try again.";
      setError(message);
      setSigningIn(false);
    }
  };

  const scope = viewerScope ?? cachedScope;
  if (scope && !signingIn) {
    const ready = isAuthenticated && viewerScope === scope;
    return <CloudProvider ready={ready}>
      {!ready && <div className="p-3 bg-card text-sm border-b border-border">Local library. <button className="underline" onClick={handleSignIn}>Sign in to reconnect</button></div>}
      <div key={scope}>{children(scope)}</div>
    </CloudProvider>;
  }

  if ((isLoading || signingIn) && !error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <div className="h-8 w-8 mx-auto border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">
            {signingIn ? "Finishing sign-in..." : "Connecting..."}
          </p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm space-y-6 text-center">
          <div>
            <svg
              className="mx-auto h-14 w-14 text-primary"
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
            <h2 className="text-lg font-semibold text-foreground mt-3">
              Sign in to continue
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Authenticate with Google to sync your audiobooks.
            </p>
          </div>

          <button
            onClick={handleSignIn}
            disabled={signingIn}
            className="w-full flex items-center justify-center gap-3 rounded-md border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-50"
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
            {signingIn ? "Signing in..." : "Sign in with Google"}
          </button>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <button
            onClick={onDisconnect}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Back to setup
          </button>
        </div>
      </div>
    );
  }

  return <div className="p-6">Loading account...</div>;
}
