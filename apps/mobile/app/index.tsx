import { Redirect } from "expo-router";
import { useConvexContext } from "./_layout";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { SetupScreen } from "../components/SetupScreen";

export default function IndexScreen() {
  const { convexUrl, setConvexUrl } = useConvexContext();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  if (!mounted) {
    return <View style={{ flex: 1, backgroundColor: "#fff" }} />;
  }

  if (convexUrl) {
    return <Redirect href="/library" />;
  }

  return <SetupScreen onConnect={setConvexUrl} />;
}
