import { expect, test } from "vitest";
import { normalizeDeploymentUrl } from "./connection";
test("normalizes deployment origins without sending keys to lookalike URLs", () => {
  expect(normalizeDeploymentUrl(" https://test.convex.cloud/ ")).toBe("https://test.convex.cloud");
  for (const url of ["https://test.convex.cloud.evil.test", "http://test.convex.cloud", "https://test.convex.cloud/path", "https://user:secret@test.convex.cloud"]) {
    expect(() => normalizeDeploymentUrl(url)).toThrow();
  }
});
