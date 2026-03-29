import AsyncStorage from "@react-native-async-storage/async-storage";

const LAST_PLAYING_BOOK_KEY = "audiobook_last_playing_book_key";

function isTrackPlayerNotificationPath(path: string): boolean {
  const normalized = path.toLowerCase();
  return (
    normalized.startsWith("trackplayer://notification.click") ||
    normalized === "notification.click" ||
    normalized.endsWith("/notification.click")
  );
}

export async function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}): Promise<string> {
  try {
    if (!isTrackPlayerNotificationPath(path)) {
      return path;
    }

    const lastBookKey = await AsyncStorage.getItem(LAST_PLAYING_BOOK_KEY);
    if (lastBookKey) {
      return `/player?bookKey=${encodeURIComponent(lastBookKey)}`;
    }

    return "/library";
  } catch {
    return "/library";
  }
}
