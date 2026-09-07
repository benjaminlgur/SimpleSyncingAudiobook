// @vitest-environment node
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
import { AuthGate } from "./AuthGate";

const mocks = vi.hoisted(() => ({ authenticated: false, loading: true, scope: undefined as string | undefined }));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: mocks.authenticated, isLoading: mocks.loading }),
  useQuery: () => mocks.scope,
  useConvexConnectionState: () => ({ isWebSocketConnected: false }),
}));
vi.mock("@convex-dev/auth/react", () => ({ useAuthActions: () => ({ signIn: vi.fn() }) }));
let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); mocks.scope = undefined; mocks.authenticated = false; });

test("cold start opens only the last verified account for the same endpoint", async () => {
  const url = "https://test.convex.cloud";
  const saved = new Map([[`audiobook_account:${encodeURIComponent(url)}`, "account-a"]]);
  vi.stubGlobal("localStorage", { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) });
  vi.stubGlobal("window", { location: { href: "https://tauri.localhost/" } });
  const child = vi.fn((scope: string) => createElement("span", null, scope));
  await act(async () => { renderer = create(createElement(AuthGate, { convexUrl: url, onDisconnect: vi.fn(), children: child })); });
  expect(child).toHaveBeenCalledWith("account-a");
  mocks.authenticated = true; mocks.scope = "account-b";
  await act(async () => { renderer.update(createElement(AuthGate, { convexUrl: url, onDisconnect: vi.fn(), children: child })); });
  expect(child).toHaveBeenLastCalledWith("account-b");
  expect(saved.get(`audiobook_account:${encodeURIComponent(url)}`)).toBe("account-b");
  act(() => renderer.unmount());
  mocks.authenticated = false; mocks.scope = undefined; child.mockClear();
  await act(async () => { renderer = create(createElement(AuthGate, { convexUrl: "https://other.convex.cloud", onDisconnect: vi.fn(), children: child })); });
  expect(child).not.toHaveBeenCalled();
});
