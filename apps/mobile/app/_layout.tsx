import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useState, useEffect, createContext, useContext } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import "../global.css";

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

export default function RootLayout() {
  const [convexUrl, setConvexUrl] = useState<string | null>(null);
  const [client, setClient] = useState<ConvexReactClient | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(CONVEX_URL_KEY).then((stored) => {
      if (stored) setConvexUrl(stored);
      setLoaded(true);
    });
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

  const handleSetUrl = async (url: string | null) => {
    if (url) {
      await AsyncStorage.setItem(CONVEX_URL_KEY, url);
    } else {
      await AsyncStorage.removeItem(CONVEX_URL_KEY);
    }
    setConvexUrl(url);
  };

  if (!loaded) return null;

  const content = (
    <ConvexContext.Provider
      value={{ convexUrl, setConvexUrl: handleSetUrl, client }}
    >
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: "#fff" },
        }}
      />
      <StatusBar style="auto" />
    </ConvexContext.Provider>
  );

  if (client) {
    return <ConvexProvider client={client}>{content}</ConvexProvider>;
  }

  return content;
}
