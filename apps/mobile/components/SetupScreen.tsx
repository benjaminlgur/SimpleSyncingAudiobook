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
  onSelfHostedConnect: (url: string) => void;
  onHostedConnect?: () => void;
}

export function SetupScreen({
  onSelfHostedConnect,
  onHostedConnect,
}: SetupScreenProps) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";

  const handleSubmit = () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setError("Please enter a Convex deployment URL");
      return;
    }
    if (!trimmed.startsWith("https://") || !trimmed.includes(".convex.cloud")) {
      setError("URL should look like: https://your-project-123.convex.cloud");
      return;
    }
    setError(null);
    onSelfHostedConnect(trimmed);
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

          <TouchableOpacity
            onPress={handleSubmit}
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
