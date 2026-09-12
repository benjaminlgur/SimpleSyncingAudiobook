import { useState } from "react";
import { Alert, Text, TouchableOpacity } from "react-native";
import * as Updates from "expo-updates";
import { stopPlaybackSession } from "../lib/playbackSession";

export function UpdateButton() {
  const [checking, setChecking] = useState(false);
  if (!Updates.isEnabled) return null;
  const check = async () => {
    setChecking(true);
    try {
      const update = await Updates.checkForUpdateAsync();
      if (!update.isAvailable) {
        Alert.alert("Up to date", "The latest app update is installed.");
        return;
      }
      await Updates.fetchUpdateAsync();
      Alert.alert(
        "Update ready",
        "Restart now to install the update? Playback will pause and your position will be saved.",
        [
          { text: "Later", style: "cancel" },
          {
            text: "Restart",
            onPress: () => {
              void (async () => {
                await stopPlaybackSession();
                await Updates.reloadAsync();
              })().catch(() =>
                Alert.alert(
                  "Unable to restart",
                  "Close and reopen the app to install the downloaded update.",
                ),
              );
            },
          },
        ],
      );
    } catch {
      Alert.alert("Unable to check for updates", "Reconnect and try again.");
    } finally {
      setChecking(false);
    }
  };
  return (
    <TouchableOpacity
      disabled={checking}
      className="p-4"
      onPress={() => void check()}
    >
      <Text className="text-orange-500">
        {checking ? "Checking for updates…" : "Check for app updates"}
      </Text>
    </TouchableOpacity>
  );
}
