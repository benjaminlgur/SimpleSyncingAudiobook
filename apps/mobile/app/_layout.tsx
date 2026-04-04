import { Stack, SplashScreen } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ConvexProvider, ConvexReactClient, useConvexAuth, useQuery } from "convex/react";
import { ConvexAuthProvider, useAuthActions } from "@convex-dev/auth/react";
import { useState, useEffect, createContext, useContext, useRef, useCallback, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { View, Text, TouchableOpacity } from "react-native";
import { useColorScheme } from "nativewind";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import * as SystemUI from "expo-system-ui";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider } from "../hooks/useTheme";
import { AppScreen } from "../components/AppScreen";
import { api } from "../../../convex/_generated/api";
import {
  ACTIVE_STORAGE_SCOPE_KEY,
  getHostedStorageScope,
  getSelfHostedStorageScope,
} from "../lib/storageScope";
import { HOSTED_CONVEX_URL } from "../lib/runtimeConfig";
import "../index";
import "../global.css";

SplashScreen.preventAutoHideAsync();
WebBrowser.maybeCompleteAuthSession();

const CONVEX_URL_KEY = "audiobook_convex_url";
const CONNECTION_MODE_KEY = "audiobook_connection_mode";
const asyncStorageTokenStorage = {
  getItem: (key: string) => AsyncStorage.getItem(key),
  setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
  removeItem: (key: string) => AsyncStorage.removeItem(key),
};

export type ConnectionMode = "hosted" | "self-hosted";

interface ConvexContextType {
  convexUrl: string | null;
  mode: ConnectionMode | null;
  storageScope: string | null;
  setConvexUrl: (url: string | null) => void;
  setSelfHostedUrl: (url: string) => void;
  setHostedMode: () => void;
  disconnect: () => void;
  client: ConvexReactClient | null;
}

const ConvexContext = createContext<ConvexContextType>({
  convexUrl: null,
  mode: null,
  storageScope: null,
  setConvexUrl: () => {},
  setSelfHostedUrl: () => {},
  setHostedMode: () => {},
  disconnect: () => {},
  client: null,
});

export function useConvexContext() {
  return useContext(ConvexContext);
}

function getBackgroundColor(isDark: boolean) {
  return isDark ? "#030712" : "#ffffff";
}

function RootSystemChrome() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const backgroundColor = getBackgroundColor(isDark);

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(backgroundColor).catch(() => {
      // Ignore unsupported environments.
    });
  }, [backgroundColor]);

  return (
    <StatusBar
      style={isDark ? "light" : "dark"}
      hidden={false}
      translucent={false}
      backgroundColor={backgroundColor}
    />
  );
}

function LayoutInner() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: getBackgroundColor(isDark) },
      }}
    />
  );
}

function AppChrome({ contextValue }: { contextValue: ConvexContextType }) {
  useEffect(() => {
    if (!contextValue.storageScope) return;
    void AsyncStorage.setItem(
      ACTIVE_STORAGE_SCOPE_KEY,
      contextValue.storageScope,
    );
  }, [contextValue.storageScope]);

  return (
    <ConvexContext.Provider value={contextValue}>
      <ThemeProvider>
        <LayoutInner />
      </ThemeProvider>
    </ConvexContext.Provider>
  );
}

function HostedAuthGate({
  convexUrl,
  onDisconnect,
  children,
}: {
  convexUrl: string;
  onDisconnect: () => void;
  children: (storageScope: string) => ReactNode;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signIn } = useAuthActions();
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const viewerScope = useQuery(
    api.authState.viewerScope,
    isAuthenticated ? {} : "skip",
  );
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";

  useEffect(() => {
    if (isAuthenticated) {
      setSigningIn(false);
      setError(null);
    }
  }, [isAuthenticated]);

  const completeOAuthSignIn = signIn as unknown as (
    provider: string | undefined,
    params?: { code?: string },
  ) => Promise<{ signingIn: boolean; redirect?: URL }>;

  const handleSignIn = useCallback(async () => {
    setSigningIn(true);
    setError(null);

    try {
      const redirectTo = Linking.createURL("/");
      const result = await signIn("google", { redirectTo });

      if (!result.redirect) {
        if (!result.signingIn) {
          setSigningIn(false);
        }
        return;
      }

      const authResult = await WebBrowser.openAuthSessionAsync(
        result.redirect.toString(),
        redirectTo,
      );

      if (authResult.type !== "success" || !("url" in authResult)) {
        setSigningIn(false);
        return;
      }

      const parsed = Linking.parse(authResult.url);
      const codeParam = parsed.queryParams?.code;
      const code = Array.isArray(codeParam) ? codeParam[0] : codeParam;

      if (typeof code !== "string" || !code) {
        setError("Sign-in did not return an authorization code.");
        setSigningIn(false);
        return;
      }

      await completeOAuthSignIn(undefined, { code });
      setSigningIn(false);
    } catch (e) {
      const message =
        e instanceof Error && e.message
          ? e.message
          : "Sign-in failed. Please try again.";
      setError(message);
      setSigningIn(false);
    }
  }, [completeOAuthSignIn, signIn]);

  if ((isLoading || signingIn) && !error) {
    return (
      <AppScreen isDark={isDark}>
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="sync" size={32} color="#f97316" />
          <Text className="text-sm text-gray-500 dark:text-gray-400 mt-4">
            {signingIn ? "Finishing sign-in..." : "Connecting..."}
          </Text>
        </View>
      </AppScreen>
    );
  }

  if (!isAuthenticated) {
    return (
      <AppScreen isDark={isDark}>
        <View className="flex-1 justify-center px-6">
          <View className="items-center mb-8">
            <Ionicons name="book" size={56} color="#f97316" />
            <Text className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-4">
              Sign in to continue
            </Text>
            <Text className="text-sm text-gray-500 dark:text-gray-400 mt-2 text-center">
              Authenticate with Google to sync your audiobooks.
            </Text>
          </View>

          <TouchableOpacity
            onPress={handleSignIn}
            disabled={signingIn}
            className="flex-row items-center justify-center border border-gray-300 dark:border-gray-700 rounded-xl py-3.5 bg-white dark:bg-gray-900"
            style={{ opacity: signingIn ? 0.6 : 1 }}
          >
            <Ionicons
              name="logo-google"
              size={20}
              color={isDark ? "#e5e7eb" : "#374151"}
              style={{ marginRight: 10 }}
            />
            <Text className="text-sm font-medium text-gray-900 dark:text-gray-100">
              Sign in with Google
            </Text>
          </TouchableOpacity>

          {error ? (
            <Text className="text-sm text-red-500 mt-4 text-center">{error}</Text>
          ) : null}

          <TouchableOpacity onPress={onDisconnect} className="py-3 mt-4">
            <Text className="text-xs text-gray-400 dark:text-gray-500 text-center">
              Back to setup
            </Text>
          </TouchableOpacity>
        </View>
      </AppScreen>
    );
  }

  if (viewerScope === undefined) {
    return (
      <AppScreen isDark={isDark}>
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="person-circle-outline" size={32} color="#f97316" />
          <Text className="text-sm text-gray-500 dark:text-gray-400 mt-4">
            Loading account...
          </Text>
        </View>
      </AppScreen>
    );
  }

  return <>{children(getHostedStorageScope(convexUrl, viewerScope))}</>;
}

export default function RootLayout() {
  const [convexUrl, setConvexUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<ConnectionMode | null>(null);
  const [client, setClient] = useState<ConvexReactClient | null>(null);
  const [loaded, setLoaded] = useState(false);
  const clientRef = useRef<ConvexReactClient | null>(null);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(CONVEX_URL_KEY),
      AsyncStorage.getItem(CONNECTION_MODE_KEY),
    ]).then(([storedUrl, storedMode]) => {
      if (storedUrl) {
        setConvexUrl(storedUrl);
        setMode((storedMode as ConnectionMode) ?? "self-hosted");
      }
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
      await AsyncStorage.removeItem(CONNECTION_MODE_KEY);
      await AsyncStorage.removeItem(ACTIVE_STORAGE_SCOPE_KEY);
    }
    setConvexUrl(url);
  };

  const handleSelfHostedUrl = async (url: string) => {
    await AsyncStorage.setItem(CONVEX_URL_KEY, url);
    await AsyncStorage.setItem(CONNECTION_MODE_KEY, "self-hosted");
    setConvexUrl(url);
    setMode("self-hosted");
  };

  const handleHostedMode = async () => {
    if (!HOSTED_CONVEX_URL) return;
    await AsyncStorage.setItem(CONVEX_URL_KEY, HOSTED_CONVEX_URL);
    await AsyncStorage.setItem(CONNECTION_MODE_KEY, "hosted");
    setConvexUrl(HOSTED_CONVEX_URL);
    setMode("hosted");
  };

  const handleDisconnect = async () => {
    await AsyncStorage.removeItem(CONVEX_URL_KEY);
    await AsyncStorage.removeItem(CONNECTION_MODE_KEY);
    await AsyncStorage.removeItem(ACTIVE_STORAGE_SCOPE_KEY);
    setConvexUrl(null);
    setMode(null);
  };

  const baseContext = {
    convexUrl: loaded ? convexUrl : null,
    mode,
    setConvexUrl: handleSetUrl,
    setSelfHostedUrl: handleSelfHostedUrl,
    setHostedMode: handleHostedMode,
    disconnect: handleDisconnect,
    client,
  };

  let content: ReactNode;

  if (mode === "hosted" && client && convexUrl) {
    content = (
      <ConvexAuthProvider
        client={client}
        storage={asyncStorageTokenStorage}
        shouldHandleCode={false}
      >
        <HostedAuthGate convexUrl={convexUrl} onDisconnect={handleDisconnect}>
          {(storageScope) => (
            <AppChrome
              contextValue={{
                ...baseContext,
                storageScope,
              }}
            />
          )}
        </HostedAuthGate>
      </ConvexAuthProvider>
    );
  } else {
    const selfHostedStorageScope =
      loaded && convexUrl && mode === "self-hosted"
        ? getSelfHostedStorageScope(convexUrl)
        : null;

    const app = (
      <AppChrome
        contextValue={{
          ...baseContext,
          storageScope: selfHostedStorageScope,
        }}
      />
    );

    content = client ? <ConvexProvider client={client}>{app}</ConvexProvider> : app;
  }

  return (
    <SafeAreaProvider>
      <RootSystemChrome />
      {content}
    </SafeAreaProvider>
  );
}
