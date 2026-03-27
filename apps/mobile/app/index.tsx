import { useRouter } from "expo-router";
import { useConvexContext } from "./_layout";
import { useEffect } from "react";
import { SetupScreen } from "../components/SetupScreen";

export default function IndexScreen() {
  const { convexUrl, setConvexUrl } = useConvexContext();
  const router = useRouter();

  useEffect(() => {
    if (convexUrl) {
      router.replace("/library");
    }
  }, [convexUrl, router]);

  if (convexUrl) return null;

  return <SetupScreen onConnect={setConvexUrl} />;
}
