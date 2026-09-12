/** Stable event names and error types only: never log tokens, titles or paths. */
export function logClientError(event: string, error?: unknown) {
  console.error(
    JSON.stringify({
      level: "error",
      event,
      timestamp: new Date().toISOString(),
      errorType: error instanceof Error ? error.name : "Error",
    }),
  );
}
