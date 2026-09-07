import { normalizeDeploymentUrl } from "@audiobook/shared";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "nativewind";
import { AppScreen } from "./AppScreen";

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
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";

  const handleSubmit = async () => {
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
    <AppScreen isDark={isDark}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        <View className="flex-1 justify-center px-6">
          <View className="items-center mb-8">
            <Ionicons name="book" size={56} color="#f97316" />
            <Text className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-4">
              Simple Syncing Audiobook
            </Text>
            <Text className="text-sm text-gray-500 dark:text-gray-400 mt-2 text-center">
              Sync your audiobook progress across devices.
            </Text>
          </View>

          {onHostedConnect && (
            <>
              <TouchableOpacity
                onPress={onHostedConnect}
                className="flex-row items-center justify-center border border-gray-300 dark:border-gray-700 rounded-xl py-3.5 mb-6 bg-white dark:bg-gray-900"
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

              <View className="flex-row items-center mb-6">
                <View className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
                <Text className="px-3 text-xs text-gray-400 dark:text-gray-500 uppercase">
                  or use your own deployment
                </Text>
                <View className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
              </View>
            </>
          )}

          <View className="mb-4">
            <Text className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
              Convex Deployment URL
            </Text>
            <TextInput
              value={url}
              onChangeText={setUrl}
              placeholder="https://your-project-123.convex.cloud"
              placeholderTextColor={isDark ? "#6b7280" : "#9ca3af"}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              className="border border-gray-300 dark:border-gray-700 rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-900"
            />
            {error && (
              <Text className="text-sm text-red-500 mt-2">{error}</Text>
            )}
          </View>

          <Text className="text-sm text-gray-700 dark:text-gray-300 mt-3 mb-2">Self-hosted access key</Text>
          <TextInput value={syncKey} onChangeText={setSyncKey} secureTextEntry autoCapitalize="none" autoCorrect={false} className="border border-gray-300 dark:border-gray-700 rounded-xl p-3 text-gray-900 dark:text-gray-100 mb-4" />
          <TouchableOpacity
            onPress={handleSubmit} disabled={connecting}
            className="bg-primary rounded-xl py-3.5 items-center"
          >
            <Text className="text-white font-medium text-sm">Connect</Text>
          </TouchableOpacity>

          <Text className="text-xs text-gray-400 dark:text-gray-500 text-center mt-6">
            {onHostedConnect
              ? "Sign in for free sync, or use your own Convex deployment for unlimited storage."
              : "Your Convex URL is stored locally on this device."}
          </Text>
        </View>
      </KeyboardAvoidingView>
    </AppScreen>
  );
}
