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

interface SetupScreenProps {
  onConnect: (url: string) => void;
}

export function SetupScreen({ onConnect }: SetupScreenProps) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

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
    onConnect(trimmed);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      className="flex-1 bg-white"
    >
      <View className="flex-1 justify-center px-6">
        <View className="items-center mb-8">
          <Ionicons name="book" size={56} color="#f97316" />
          <Text className="text-2xl font-bold text-gray-900 mt-4">
            Audiobook Player
          </Text>
          <Text className="text-sm text-gray-500 mt-2 text-center">
            Connect to your Convex deployment to sync your audiobook progress
            across devices.
          </Text>
        </View>

        <View className="mb-4">
          <Text className="text-sm font-medium text-gray-900 mb-2">
            Convex Deployment URL
          </Text>
          <TextInput
            value={url}
            onChangeText={setUrl}
            placeholder="https://your-project-123.convex.cloud"
            placeholderTextColor="#9ca3af"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            className="border border-gray-300 rounded-xl px-4 py-3 text-sm text-gray-900"
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

        <Text className="text-xs text-gray-400 text-center mt-6">
          Your Convex URL is stored locally on this device.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}
