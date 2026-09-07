import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

const keyFor = (key: string) => `audiobook.${bytesToHex(sha256(utf8ToBytes(key)))}`;
export const secureStorage = {
  async getItem(key: string) {
    const value = await SecureStore.getItemAsync(keyFor(key));
    if (value !== null) return value;
    const legacy = await AsyncStorage.getItem(key);
    if (legacy !== null) {
      await SecureStore.setItemAsync(keyFor(key), legacy);
      await AsyncStorage.removeItem(key);
    }
    return legacy;
  },
  setItem: (key: string, value: string) => SecureStore.setItemAsync(keyFor(key), value),
  async removeItem(key: string) {
    await SecureStore.deleteItemAsync(keyFor(key));
    await AsyncStorage.removeItem(key);
  },
};
