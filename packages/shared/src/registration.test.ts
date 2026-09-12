import { afterEach, expect, test, vi } from "vitest";
import { forgetDeviceRegistration, registerDeviceOnce } from "./registration";
afterEach(() => vi.useRealTimers());

test("library re-renders and simultaneous player registration make one mutation", async () => {
  const register = vi.fn(async () => null);
  await Promise.all([
    registerDeviceOnce("device-a", "book", register),
    registerDeviceOnce("device-a", "book", register),
  ]);
  await registerDeviceOnce("device-a", "book", register);
  expect(register).toHaveBeenCalledTimes(1);
  forgetDeviceRegistration("device-a", "book");
  await registerDeviceOnce("device-a", "book", register);
  expect(register).toHaveBeenCalledTimes(2);
});

test("large library registration respects the server retry delay", async () => {
  vi.useFakeTimers();
  const register = vi
    .fn()
    .mockRejectedValueOnce({
      data: { code: "RATE_LIMITED", retryAfterMs: 6000 },
    })
    .mockResolvedValue(null);
  const registration = registerDeviceOnce("device-b", "book", register);
  await vi.advanceTimersByTimeAsync(6000);
  expect(register).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(100);
  await registration;
  expect(register).toHaveBeenCalledTimes(2);
});
