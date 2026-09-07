// @vitest-environment node
import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
import { AppShell } from "./AppShell";
import { getScopedStorageKey, getStorageScope } from "../lib/storageScope";

const mocks = vi.hoisted(() => ({ mounted: vi.fn(), stopped: vi.fn(), query: vi.fn(async () => ({})) }));
vi.mock("convex/react", () => ({ useConvex: () => ({ query: mocks.query }) }));
vi.mock("../App", () => ({ useConnectionMode: () => "self-hosted" }));
vi.mock("../lib/tauri-fs", () => ({ checkPathExists: async () => true }));
vi.mock("./Library", () => ({ Library: (props: { books: unknown[]; onSelectBook: (book: unknown) => void }) => createElement("button", { onClick: () => props.onSelectBook(props.books[0]) }, "open") }));
vi.mock("./Settings", () => ({ Settings: () => null }));
vi.mock("./Player", () => ({ Player: (props: { onBack: () => void }) => {
  useEffect(() => { mocks.mounted(); return () => { mocks.stopped(); }; }, []);
  return createElement("button", { onClick: props.onBack }, "back");
} }));
let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); vi.clearAllMocks(); });

test("library navigation preserves the application playback owner", async () => {
  const url = "https://test.convex.cloud";
  const data = new Map([[getScopedStorageKey("audiobook_library", getStorageScope({ mode: "self-hosted", convexUrl: url, userScope: null })!), JSON.stringify([{ name: "Book", checksum: "sum", folderPath: "/books", chapters: [] }])]]);
  vi.stubGlobal("localStorage", { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), length: 0 });
  await act(async () => { renderer = create(createElement(AppShell, { convexUrl: url, onDisconnect: vi.fn() })); });
  await act(async () => { renderer.root.findAllByType("button").find((b) => b.children[0] === "open")!.props.onClick(); });
  expect(mocks.mounted).toHaveBeenCalledTimes(1);
  act(() => { renderer.root.findAllByType("button").find((b) => b.children[0] === "back")!.props.onClick(); });
  expect(mocks.stopped).not.toHaveBeenCalled();
  act(() => renderer.unmount());
  expect(mocks.stopped).toHaveBeenCalledTimes(1);
});
