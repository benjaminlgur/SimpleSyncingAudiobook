import { invoke } from "@tauri-apps/api/core";
import { CloudProvider } from "@audiobook/shared/react";
import { useState, useEffect, createContext, useContext } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { SetupScreen } from "./components/SetupScreen";
import { AppShell } from "./components/AppShell";
import { AuthGate } from "./components/AuthGate";
import { ThemeProvider } from "./hooks/useTheme";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { secureStorage } from "./lib/secureStorage";

const CONVEX_URL_KEY = "audiobook_convex_url";
const CONNECTION_MODE_KEY = "audiobook_connection_mode";
const HOSTED_CONVEX_URL = import.meta.env.VITE_HOSTED_CONVEX_URL as
  string | undefined;

export type ConnectionMode = "hosted" | "self-hosted";

interface ConnectionContextType {
  mode: ConnectionMode | null;
}

const ConnectionContext = createContext<ConnectionContextType>({ mode: null });

export function useConnectionMode() {
  return useContext(ConnectionContext).mode;
}

export default function App() {
  const [convexUrl, setConvexUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<ConnectionMode | null>(null);
  const [syncKey, setSyncKey] = useState<string | undefined>(undefined);
  const [client, setClient] = useState<ConvexReactClient | null>(null);
  const [keyState, setKeyState] = useState<
    "loading" | "missing" | "ready" | "error"
  >("loading");
  const [configure, setConfigure] = useState(false);

  const readKey = async (url: string) => {
    setKeyState("loading");
    try {
      const key = await invoke<string | null>("get_sync_key", {
        endpoint: url,
      });
      setSyncKey(key ?? undefined);
      setKeyState(key ? "ready" : "missing");
    } catch {
      setKeyState("error");
    }
  };

  useEffect(() => {
    const storedUrl = localStorage.getItem(CONVEX_URL_KEY);
    const storedMode =
      (localStorage.getItem(CONNECTION_MODE_KEY) as ConnectionMode) || null;
    if (storedUrl) {
      if ((storedMode ?? "self-hosted") === "self-hosted")
        void readKey(storedUrl);
      setConvexUrl(storedUrl);
      setMode(storedMode ?? "self-hosted");
    }
  }, []);

  useEffect(() => {
    if (!convexUrl) {
      setClient(null);
      return;
    }
    const c = new ConvexReactClient(convexUrl);
    setClient(c);
    return () => {
      c.close();
    };
  }, [convexUrl]);

  const handleSelfHostedConnect = async (url: string, key: string) => {
    await invoke("set_sync_key", { endpoint: url, value: key });
    setSyncKey(key);
    setKeyState("ready");
    setConfigure(false);
    localStorage.setItem(CONVEX_URL_KEY, url);
    localStorage.setItem(CONNECTION_MODE_KEY, "self-hosted");
    setConvexUrl(url);
    setMode("self-hosted");
  };

  const handleHostedConnect = () => {
    if (!HOSTED_CONVEX_URL) return;
    setConfigure(false);
    localStorage.setItem(CONVEX_URL_KEY, HOSTED_CONVEX_URL);
    localStorage.setItem(CONNECTION_MODE_KEY, "hosted");
    setConvexUrl(HOSTED_CONVEX_URL);
    setMode("hosted");
  };

  const handleDisconnect = () => {
    if (convexUrl && mode === "self-hosted")
      void invoke("set_sync_key", { endpoint: convexUrl, value: null }).catch(
        () => {},
      );
    setSyncKey(undefined);
    if (convexUrl)
      localStorage.removeItem(
        `audiobook_account:${encodeURIComponent(convexUrl)}`,
      );
    localStorage.removeItem(CONVEX_URL_KEY);
    localStorage.removeItem(CONNECTION_MODE_KEY);
    setConvexUrl(null);
    setMode(null);
  };

  if (!convexUrl || !client || configure) {
    return (
      <ThemeProvider>
        {configure && (
          <button className="p-3 underline" onClick={() => setConfigure(false)}>
            Back to library
          </button>
        )}
        <SetupScreen
          initialUrl={convexUrl ?? undefined}
          onSelfHostedConnect={handleSelfHostedConnect}
          onHostedConnect={HOSTED_CONVEX_URL ? handleHostedConnect : undefined}
        />
      </ThemeProvider>
    );
  }

  if (mode === "hosted") {
    return (
      <ThemeProvider>
        <ErrorBoundary onSettings={() => setConfigure(true)}>
          <ConvexAuthProvider
            client={client}
            shouldHandleCode={false}
            storage={secureStorage}
          >
            <ConnectionContext.Provider value={{ mode }}>
              <AuthGate convexUrl={convexUrl} onDisconnect={handleDisconnect}>
                {(userScope) => (
                  <AppShell
                    userScope={userScope}
                    convexUrl={convexUrl}
                    onDisconnect={handleDisconnect}
                  />
                )}
              </AuthGate>
            </ConnectionContext.Provider>
          </ConvexAuthProvider>
        </ErrorBoundary>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <ErrorBoundary onSettings={() => setConfigure(true)}>
        <ConvexProvider client={client}>
          <ConnectionContext.Provider value={{ mode }}>
            <CloudProvider ready={keyState === "ready"} syncKey={syncKey}>
              {keyState !== "ready" && (
                <div role="status" className="p-3 text-sm">
                  {keyState === "loading"
                    ? "Unlocking saved access key…"
                    : keyState === "error"
                      ? "Your keyring is unavailable. Unlock it and retry. Your connection is still saved."
                      : "No access key is stored. Your local library is available."}
                  <button
                    className="underline mx-2"
                    onClick={() => void readKey(convexUrl)}
                  >
                    Retry
                  </button>
                  <button
                    className="underline"
                    onClick={() => setConfigure(true)}
                  >
                    Connection settings
                  </button>
                </div>
              )}
              <AppShell convexUrl={convexUrl} onDisconnect={handleDisconnect} />
            </CloudProvider>
          </ConnectionContext.Provider>
        </ConvexProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
}
