// A mounted library and player can request the same registration simultaneously.
// Cache only successful registrations; failures remain retryable on reconnect.
const registrations = new Map<
  string,
  { promise: Promise<unknown>; expires: number }
>();
export function registerDeviceOnce(
  deviceId: string,
  audiobookId: string,
  register: () => Promise<unknown>,
) {
  const key = `${deviceId}:${audiobookId}`;
  const existing = registrations.get(key);
  if (existing && existing.expires > Date.now()) return existing.promise;
  const entry = {
    promise: Promise.resolve() as Promise<unknown>,
    expires: Infinity,
  };
  entry.promise = Promise.resolve()
    .then(async () => {
      for (let attempt = 0; ; attempt++) {
        if (registrations.get(key) !== entry)
          throw new Error("Device registration cancelled");
        try {
          return await register();
        } catch (error) {
          const data =
            error && typeof error === "object" && "data" in error
              ? error.data
              : null;
          if (
            attempt >= 3 ||
            !data ||
            typeof data !== "object" ||
            !("code" in data) ||
            data.code !== "RATE_LIMITED" ||
            !("retryAfterMs" in data) ||
            typeof data.retryAfterMs !== "number"
          )
            throw error;
          const delay =
            Math.min(60000, Math.max(1000, data.retryAfterMs)) + 100;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    })
    .then((result) => {
      entry.expires = Date.now() + 30 * 60 * 1000;
      return result;
    })
    .catch((error: unknown) => {
      if (registrations.get(key) === entry) registrations.delete(key);
      throw error;
    });
  registrations.set(key, entry);
  for (const [oldKey, value] of registrations)
    if (value.expires <= Date.now()) registrations.delete(oldKey);
  return entry.promise;
}

export function forgetDeviceRegistration(
  deviceId: string,
  audiobookId: string,
) {
  registrations.delete(`${deviceId}:${audiobookId}`);
}
