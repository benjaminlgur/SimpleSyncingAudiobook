// @vitest-environment node
import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
const mocks = vi.hoisted(() => ({ crash: false }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@sentry/react", () => ({ captureException: vi.fn() }));
vi.mock("@convex-dev/auth/react", () => ({
  ConvexAuthProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./components/AuthGate", () => ({ AuthGate: () => null }));
vi.mock("convex/react", () => ({
  ConvexReactClient: class {
    close() {}
  },
  ConvexProvider: ({ children }: { children: ReactNode }) => children,
  useConvexConnectionState: () => ({ isWebSocketConnected: true }),
}));
vi.mock("./hooks/useTheme", () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./components/SetupScreen", () => ({
  SetupScreen: () => createElement("p", {}, "Connection settings"),
}));
vi.mock("./components/AppShell", () => ({
  AppShell: () => {
    if (mocks.crash) throw new Error("Access key rotated");
    return createElement("p", {}, "Local library");
  },
}));
let renderer: ReactTestRenderer | undefined;
let stored: Map<string, string>;
beforeEach(() => {
  mocks.crash = false;
  stored = new Map([
    ["audiobook_convex_url", "https://saved.convex.cloud"],
    ["audiobook_connection_mode", "self-hosted"],
  ]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
});
afterEach(() => {
  act(() => renderer?.unmount());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

test("a locked keyring keeps the URL and local library and can be retried", async () => {
  vi.mocked(invoke)
    .mockRejectedValueOnce(new Error("Keyring locked"))
    .mockResolvedValueOnce("saved-key");
  await act(async () => {
    renderer = create(createElement(App));
  });
  expect(JSON.stringify(renderer!.toJSON())).toContain(
    "Your keyring is unavailable",
  );
  expect(JSON.stringify(renderer!.toJSON())).toContain("Local library");
  await act(async () => {
    renderer!.root
      .findAllByType("button")
      .find((node) => node.children.includes("Retry"))!
      .props.onClick();
  });
  expect(stored.get("audiobook_convex_url")).toBe("https://saved.convex.cloud");
  expect(JSON.stringify(renderer!.toJSON())).not.toContain(
    "Your keyring is unavailable",
  );
  expect(invoke).toHaveBeenCalledTimes(2);
});

test("query render errors expose connection recovery without deleting configuration", async () => {
  mocks.crash = true;
  vi.mocked(invoke).mockResolvedValueOnce("saved-key");
  await act(async () => {
    renderer = create(createElement(App));
  });
  expect(JSON.stringify(renderer!.toJSON())).toContain(
    "Your local library is still saved",
  );
  act(() =>
    renderer!.root
      .findAllByType("button")
      .find((node) => node.children.includes("Connection settings"))!
      .props.onClick(),
  );
  expect(stored.get("audiobook_convex_url")).toBe("https://saved.convex.cloud");
  expect(invoke).not.toHaveBeenCalledWith("set_sync_key", expect.anything());
});
