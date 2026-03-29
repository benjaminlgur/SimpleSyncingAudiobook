import { useState, useEffect } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { SetupScreen } from "./components/SetupScreen";
import { AppShell } from "./components/AppShell";
import { ThemeProvider } from "./hooks/useTheme";

const CONVEX_URL_KEY = "audiobook_convex_url";

export default function App() {
  const [convexUrl, setConvexUrl] = useState<string | null>(null);
  const [client, setClient] = useState<ConvexReactClient | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(CONVEX_URL_KEY);
    if (stored) {
      setConvexUrl(stored);
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

  const handleSetUrl = (url: string) => {
    localStorage.setItem(CONVEX_URL_KEY, url);
    setConvexUrl(url);
  };

  const handleDisconnect = () => {
    localStorage.removeItem(CONVEX_URL_KEY);
    setConvexUrl(null);
  };

  if (!convexUrl || !client) {
    return (
      <ThemeProvider>
        <SetupScreen onConnect={handleSetUrl} />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <ConvexProvider client={client}>
        <AppShell convexUrl={convexUrl} onDisconnect={handleDisconnect} />
      </ConvexProvider>
    </ThemeProvider>
  );
}
