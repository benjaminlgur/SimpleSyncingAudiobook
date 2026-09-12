// @vitest-environment node
import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
import { AppShell } from "./AppShell";
import { getScopedStorageKey, getStorageScope } from "../lib/storageScope";
import { CloudContext } from "@audiobook/shared/react";
import type { LocalAudiobook } from "./AppShell";

const mocks = vi.hoisted(() => ({
  mounted: vi.fn(),
  stopped: vi.fn(),
  query: vi.fn(async () => ({})),
  register: vi.fn<() => Promise<string>>(),
}));
vi.mock("convex/react", () => ({ useConvex: () => ({ query: mocks.query }) }));
vi.mock("../App", () => ({ useConnectionMode: () => "self-hosted" }));
vi.mock("../lib/tauri-fs", () => ({ checkPathExists: async () => true }));
vi.mock("./Library", () => ({
  Library: (props: {
    books: LocalAudiobook[];
    onSelectBook: (book: LocalAudiobook) => void;
    onBookConvexIdResolved: (book: LocalAudiobook, id: string) => void;
  }) => {
    useEffect(() => {
      const book = props.books[0];
      if (!mocks.register.getMockImplementation() || !book || book.convexId)
        return;
      let cancelled = false;
      void mocks.register().then((id) => {
        if (!cancelled) props.onBookConvexIdResolved(book, id);
      });
      return () => {
        cancelled = true;
      };
    }, [props.books, props.onBookConvexIdResolved]);
    return createElement(
      "button",
      { onClick: () => props.onSelectBook(props.books[0]) },
      "open",
    );
  },
}));
vi.mock("./Settings", () => ({ Settings: () => null }));
vi.mock("./Player", () => ({
  Player: (props: { onBack: () => void }) => {
    useEffect(() => {
      mocks.mounted();
      return () => {
        mocks.stopped();
      };
    }, []);
    return createElement("button", { onClick: props.onBack }, "back");
  },
}));
let renderer: ReactTestRenderer;
afterEach(() => {
  act(() => renderer?.unmount());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  mocks.register.mockReset();
});

test("connection updates do not restart an in-flight book registration", async () => {
  const url = "https://test.convex.cloud";
  const scope = getStorageScope({
    mode: "self-hosted",
    convexUrl: url,
    userScope: null,
  })!;
  const libraryKey = getScopedStorageKey("audiobook_library", scope);
  const data = new Map([
    [
      libraryKey,
      JSON.stringify([
        { name: "Book", checksum: "sum", folderPath: "/books", chapters: [] },
      ]),
    ],
  ]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    length: 0,
  });
  const shell = createElement(AppShell, {
    convexUrl: url,
    onDisconnect: vi.fn(),
  });
  const canSync = () => true;
  const render = () =>
    createElement(CloudContext.Provider, {
      value: { ready: true, canSync },
      children: shell,
    });
  let resolve!: (id: string) => void;
  mocks.register.mockImplementation(
    () =>
      new Promise<string>((done) => {
        resolve = done;
      }),
  );
  await act(async () => {
    renderer = create(render());
  });
  // Local file validation can update the book once during startup. Subsequent
  // connection notifications must preserve the in-flight registration.
  const callsBefore = mocks.register.mock.calls.length;
  expect(callsBefore).toBeGreaterThan(0);
  for (let update = 0; update < 5; update++) {
    await act(async () => {
      renderer.update(render());
    });
  }
  expect(mocks.register).toHaveBeenCalledTimes(callsBefore);
  await act(async () => {
    resolve("registered-book");
  });
  expect(JSON.parse(data.get(libraryKey)!)[0].convexId).toBe("registered-book");
});

test("library navigation preserves the application playback owner", async () => {
  const url = "https://test.convex.cloud";
  const data = new Map([
    [
      getScopedStorageKey(
        "audiobook_library",
        getStorageScope({
          mode: "self-hosted",
          convexUrl: url,
          userScope: null,
        })!,
      ),
      JSON.stringify([
        { name: "Book", checksum: "sum", folderPath: "/books", chapters: [] },
      ]),
    ],
  ]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    length: 0,
  });
  await act(async () => {
    renderer = create(
      createElement(AppShell, { convexUrl: url, onDisconnect: vi.fn() }),
    );
  });
  await act(async () => {
    renderer.root
      .findAllByType("button")
      .find((b) => b.children[0] === "open")!
      .props.onClick();
  });
  expect(mocks.mounted).toHaveBeenCalledTimes(1);
  act(() => {
    renderer.root
      .findAllByType("button")
      .find((b) => b.children[0] === "back")!
      .props.onClick();
  });
  expect(mocks.stopped).not.toHaveBeenCalled();
  act(() => renderer.unmount());
  expect(mocks.stopped).toHaveBeenCalledTimes(1);
});
