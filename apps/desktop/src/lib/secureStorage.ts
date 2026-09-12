import { invoke } from "@tauri-apps/api/core";

// Convex namespaces these keys by endpoint. Migrate only after a successful
// keyring write, so a locked keyring never destroys the previous credential.
export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const endpoint = `hosted-auth:${key}`;
    const stored = await invoke<string | null>("get_sync_key", { endpoint });
    if (stored !== null) {
      localStorage.removeItem(key);
      return stored;
    }
    const legacy = localStorage.getItem(key);
    if (legacy !== null) {
      await invoke("set_sync_key", { endpoint, value: legacy });
      localStorage.removeItem(key);
    }
    return legacy;
  },
  async setItem(key: string, value: string) {
    await invoke("set_sync_key", { endpoint: `hosted-auth:${key}`, value });
    localStorage.removeItem(key);
  },
  async removeItem(key: string) {
    await invoke("set_sync_key", {
      endpoint: `hosted-auth:${key}`,
      value: null,
    });
    localStorage.removeItem(key);
  },
};
