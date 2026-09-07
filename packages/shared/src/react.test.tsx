// @vitest-environment node
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
import { CloudProvider, useCloudMutation, useCloudQuery } from "./react";
import { makeFunctionReference } from "convex/server";

const mocks = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn(async () => true), connected: true }));
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => mocks.query(...args),
  useMutation: () => mocks.mutation,
  useConvexConnectionState: () => ({ isWebSocketConnected: mocks.connected }),
}));
let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); vi.clearAllMocks(); mocks.connected = true; });
const query = makeFunctionReference<"query", { book: string }>("positions:get");
const mutation = makeFunctionReference<"mutation", { book: string }>("positions:update");
let backgroundPush: ReturnType<typeof useCloudMutation<typeof mutation>>;
function Screen() { useCloudQuery(query, { book: "book" }); backgroundPush = useCloudMutation(mutation); return null; }
const app = (ready: boolean, visible = true) => createElement(CloudProvider, { ready, children: visible ? createElement(Screen) : null });

test("cached local access never subscribes or queues writes before cloud authorization", async () => {
  await act(async () => { renderer = create(app(false)); });
  expect(mocks.query).toHaveBeenLastCalledWith(query, "skip");
  await expect(backgroundPush({ book: "book" })).rejects.toThrow("reconnect");
  expect(mocks.mutation).not.toHaveBeenCalled();
});

test("a background service retains live access after its screen closes, but loses it on logout", async () => {
  await act(async () => { renderer = create(app(false)); });
  const retainedPush = backgroundPush;
  await act(async () => { renderer.update(app(true, false)); });
  await expect(retainedPush({ book: "book" })).resolves.toBe(true);
  act(() => renderer.unmount());
  await expect(retainedPush({ book: "book" })).rejects.toThrow("reconnect");
});

test("a disconnected websocket cannot leave imports waiting on an offline mutation", async () => {
  mocks.connected = false;
  await act(async () => { renderer = create(app(true)); });
  await expect(backgroundPush({ book: "book" })).rejects.toThrow("reconnect");
});
