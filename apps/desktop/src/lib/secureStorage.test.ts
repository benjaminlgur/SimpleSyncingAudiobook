// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { secureStorage } from "./secureStorage";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

test("legacy auth tokens are removed only after the keyring accepts them", async () => {
  const remove = vi.fn();
  vi.stubGlobal("localStorage", {
    getItem: () => "refresh-token",
    removeItem: remove,
  });
  vi.mocked(invoke)
    .mockResolvedValueOnce(null)
    .mockRejectedValueOnce(new Error("Keyring locked"));
  await expect(secureStorage.getItem("auth-key")).rejects.toThrow(
    "Keyring locked",
  );
  expect(remove).not.toHaveBeenCalled();
  vi.mocked(invoke)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(undefined);
  expect(await secureStorage.getItem("auth-key")).toBe("refresh-token");
  expect(remove).toHaveBeenCalledWith("auth-key");
});
