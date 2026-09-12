import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AudiobookMeta } from "@audiobook/shared";
interface LocalAudiobook extends AudiobookMeta {
  convexId?: string;
  missing?: boolean;
}
const LIBRARY_KEY = "audiobook_library";
function decodeUriValue(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
export async function readStoredLibrary(
  storageKey: string,
): Promise<LocalAudiobook[]> {
  const stored = await AsyncStorage.getItem(storageKey);
  if (!stored) return [];

  try {
    return JSON.parse(stored) as LocalAudiobook[];
  } catch {
    return [];
  }
}

function getHostedScopeMigrationMatch(scope: string): {
  keyPrefix: string;
  userMarker: string;
} | null {
  if (!scope.startsWith("hosted:")) {
    return null;
  }

  const [, encodedUrl, encodedUserId] = scope.split(":");
  if (!encodedUrl || !encodedUserId) {
    return null;
  }

  const userId = decodeUriValue(encodedUserId);
  return {
    keyPrefix: `hosted:${encodedUrl}:`,
    userMarker: `%7C${userId}%7C`,
  };
}

export async function findLegacyHostedScopedKey(
  baseKey: string,
  scope: string,
): Promise<string | null> {
  const match = getHostedScopeMigrationMatch(scope);
  if (!match) {
    return null;
  }

  const keys = await AsyncStorage.getAllKeys();
  return (
    keys.find(
      (key) =>
        key.startsWith(`${baseKey}:${match.keyPrefix}`) &&
        key.includes(match.userMarker),
    ) ?? null
  );
}

export async function loadScopedLibrary(
  storageKey: string,
  storageScope: string,
  legacyKey?: string,
): Promise<LocalAudiobook[]> {
  const scopedStored = await AsyncStorage.getItem(storageKey);
  if (scopedStored !== null) {
    return readStoredLibrary(storageKey);
  }

  const legacyHostedKey = await findLegacyHostedScopedKey(
    LIBRARY_KEY,
    storageScope,
  );
  if (legacyHostedKey) {
    const hostedLibrary = await readStoredLibrary(legacyHostedKey);
    if (hostedLibrary.length > 0) {
      await AsyncStorage.setItem(storageKey, JSON.stringify(hostedLibrary));
    }
    return hostedLibrary;
  }

  if (!legacyKey) {
    return [];
  }

  const legacyStored = await AsyncStorage.getItem(legacyKey);
  if (legacyStored === null) {
    return [];
  }

  const legacyLibrary = await readStoredLibrary(legacyKey);
  if (legacyLibrary.length > 0) {
    await AsyncStorage.setItem(storageKey, JSON.stringify(legacyLibrary));
  }
  return legacyLibrary;
}
