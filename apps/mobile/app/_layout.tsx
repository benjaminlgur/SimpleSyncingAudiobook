import { Stack, SplashScreen } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useState, useEffect, createContext, useContext, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import "../global.css";

SplashScreen.preventAutoHideAsync();

const CONVEX_URL_KEY = "audiobook_convex_url";

interface ConvexContextType {
  convexUrl: string | null;
  setConvexUrl: (url: string | null) => void;
  client: ConvexReactClient | null;
}

const ConvexContext = createContext<ConvexContextType>({
  convexUrl: null,
  setConvexUrl: () => {},
  client: null,
});

export function useConvexContext() {
  return useContext(ConvexContext);
}

function MaybeConvexProvider({
  client,
  children,
}: {
  client: ConvexReactClient | null;
  children: React.ReactNode;
}) {
  if (client) {
    return <ConvexProvider client={client}>{children}</ConvexProvider>;
  }
  return <>{children}</>;
}

export default function RootLayout() {
  const [convexUrl, setConvexUrl] = useState<string | null>(null);
  const [client, setClient] = useState<ConvexReactClient | null>(null);
  const [loaded, setLoaded] = useState(false);
  const clientRef = useRef<ConvexReactClient | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(CONVEX_URL_KEY).then((stored) => {
      if (stored) setConvexUrl(stored);
      setLoaded(true);
      SplashScreen.hideAsync();
    });
  }, []);

  useEffect(() => {
    if (!convexUrl) {
      if (clientRef.current) {
        clientRef.current.close();
        clientRef.current = null;
      }
      setClient(null);
      return;
    }
    const c = new ConvexReactClient(convexUrl);
    clientRef.current = c;
    setClient(c);
    return () => {
      c.close();
      clientRef.current = null;
    };
  }, [convexUrl]);

  const handleSetUrl = async (url: string | null) => {
    if (url) {
      await AsyncStorage.setItem(CONVEX_URL_KEY, url);
    } else {
      await AsyncStorage.removeItem(CONVEX_URL_KEY);
    }
    setConvexUrl(url);
  };

  return (
    <MaybeConvexProvider client={client}>
      <ConvexContext.Provider
        value={{ convexUrl: loaded ? convexUrl : null, setConvexUrl: handleSetUrl, client }}
      >
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: "#fff" },
          }}
        />
        <StatusBar style="auto" />
      </ConvexContext.Provider>
    </MaybeConvexProvider>
  );
}
