import type { ReactNode } from "react";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

interface AppScreenProps {
  children: ReactNode;
  edges?: Edge[];
  isDark: boolean;
  style?: StyleProp<ViewStyle>;
}

export function AppScreen({
  children,
  edges = ["top"],
  isDark,
  style,
}: AppScreenProps) {
  return (
    <SafeAreaView
      edges={edges}
      style={[
        styles.safeArea,
        { backgroundColor: isDark ? "#030712" : "#ffffff" },
        style,
      ]}
    >
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
});
