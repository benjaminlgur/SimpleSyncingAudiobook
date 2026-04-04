import { View, Text, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexContext } from "./_layout";
import { AppScreen } from "../components/AppScreen";
import { useTheme } from "../hooks/useTheme";

type ThemePreference = "light" | "dark" | "system";

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: "light", label: "Light", icon: "sunny-outline" },
  { value: "dark", label: "Dark", icon: "moon-outline" },
  { value: "system", label: "System", icon: "phone-portrait-outline" },
];

function SignOutButton({ onSignOut }: { onSignOut: () => void }) {
  const { signOut } = useAuthActions();
  const { isDark } = useTheme();

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch {
      // May fail if already signed out
    }
    onSignOut();
  };

  return (
    <>
      <TouchableOpacity
        onPress={handleSignOut}
        className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20 px-4 py-3.5"
      >
        <Text className="text-sm font-medium text-red-600 dark:text-red-400">
          Sign out
        </Text>
      </TouchableOpacity>
      <Text className="text-xs text-gray-400 dark:text-gray-500 mt-2">
        This will sign you out and return to the setup screen.
      </Text>
    </>
  );
}

function DisconnectButton({ onDisconnect }: { onDisconnect: () => void }) {
  return (
    <>
      <TouchableOpacity
        onPress={onDisconnect}
        className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20 px-4 py-3.5"
      >
        <Text className="text-sm font-medium text-red-600 dark:text-red-400">
          Disconnect from Convex
        </Text>
      </TouchableOpacity>
      <Text className="text-xs text-gray-400 dark:text-gray-500 mt-2">
        This will remove the saved deployment URL and return to the setup screen.
      </Text>
    </>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const { disconnect, mode } = useConvexContext();
  const { theme, setTheme, isDark } = useTheme();
  const isHosted = mode === "hosted";

  const handleDisconnect = () => {
    disconnect();
    router.replace("/");
  };

  return (
    <AppScreen isDark={isDark}>
      <View className="flex-1">
        <View className="px-4 pt-2 pb-3 flex-row items-center border-b border-gray-200 dark:border-gray-800">
          <TouchableOpacity
            onPress={() => router.back()}
            className="flex-row items-center"
          >
            <Ionicons name="chevron-back" size={20} color={isDark ? "#9ca3af" : "#6b7280"} />
            <Text className="text-sm text-gray-500 dark:text-gray-400 ml-1">Library</Text>
          </TouchableOpacity>
        </View>

        <View className="flex-1 px-4 pt-4">
          <Text className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-6">Settings</Text>

          <Text className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
            Appearance
          </Text>
          <View className="flex-row gap-2 mb-8">
            {THEME_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                onPress={() => setTheme(option.value)}
                className={`flex-1 items-center py-4 rounded-xl border ${
                  theme === option.value
                    ? "border-primary bg-orange-50 dark:bg-orange-950/30"
                    : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"
                }`}
              >
                <Ionicons
                  name={option.icon}
                  size={22}
                  color={theme === option.value ? "#f97316" : (isDark ? "#9ca3af" : "#6b7280")}
                />
                <Text
                  className={`text-xs font-medium mt-2 ${
                    theme === option.value
                      ? "text-primary"
                      : "text-gray-500 dark:text-gray-400"
                  }`}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
            {isHosted ? "Account" : "Connection"}
          </Text>
          {isHosted ? (
            <SignOutButton onSignOut={handleDisconnect} />
          ) : (
            <DisconnectButton onDisconnect={handleDisconnect} />
          )}
        </View>
      </View>
    </AppScreen>
  );
}
