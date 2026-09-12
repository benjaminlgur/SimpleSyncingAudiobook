// @vitest-environment node
import { test, expect } from "vitest";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const { configureDesktopRelease } = createRequire(import.meta.url)(
  "./desktop-signing.cjs",
);
const updater = {
  TAURI_UPDATER_PUBLIC_KEY: "test-public-key",
  TAURI_SIGNING_PRIVATE_KEY: "test-private-key",
};
const config = { bundle: {}, plugins: {} };

test("unsigned Windows installers retain mandatory updater verification", () => {
  const result = configureDesktopRelease(
    {
      bundle: { windows: { certificateThumbprint: "old", signCommand: "old" } },
    },
    { ...updater, DESKTOP_SIGNING_MODE: "unsigned" },
    "win32",
  );
  expect(result.bundle.windows).toEqual({});
  expect(result.bundle.createUpdaterArtifacts).toBe(true);
  expect(result.plugins.updater.pubkey).toBe(updater.TAURI_UPDATER_PUBLIC_KEY);
});

test("macOS installers use ad-hoc signing without Apple credentials", () => {
  const result = configureDesktopRelease(
    config,
    { ...updater, DESKTOP_SIGNING_MODE: "unsigned" },
    "darwin",
  );
  expect(result.bundle.macOS.signingIdentity).toBe("-");
  expect(result.bundle.createUpdaterArtifacts).toBe(true);
  expect(config).toEqual({ bundle: {}, plugins: {} });
});

test("unsigned mode still rejects missing updater keys", () => {
  for (const key of Object.keys(updater)) {
    expect(() =>
      configureDesktopRelease(
        config,
        { ...updater, DESKTOP_SIGNING_MODE: "unsigned", [key]: "" },
        "win32",
      ),
    ).toThrow(key);
  }
});

test("signed mode remains the default and requires platform credentials", () => {
  expect(() => configureDesktopRelease(config, updater, "win32")).toThrow(
    "WINDOWS_CERTIFICATE_THUMBPRINT",
  );
  expect(() => configureDesktopRelease(config, updater, "darwin")).toThrow(
    "APPLE_CERTIFICATE",
  );
  expect(() =>
    configureDesktopRelease(
      config,
      { ...updater, DESKTOP_SIGNING_MODE: "typo" },
      "win32",
    ),
  ).toThrow("DESKTOP_SIGNING_MODE");
});

test("release validation permits explicit unsigned desktops without relaxing Android or updater signing", () => {
  const validate = (overrides: Record<string, string>) =>
    spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./validate-release.cjs", import.meta.url))],
      {
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          HOSTED_CONVEX_URL: "https://example.convex.cloud",
          CONVEX_DEPLOY_KEY_PROD: "test-deploy-key",
          ...updater,
          RELEASE_PLATFORMS: "windows,macos",
          DESKTOP_SIGNING_MODE: "unsigned",
          ...overrides,
        },
      },
    );
  expect(validate({}).status).toBe(0);
  const signed = validate({ DESKTOP_SIGNING_MODE: "signed" });
  expect(signed.status).not.toBe(0);
  expect(signed.stderr).toContain("WINDOWS_CERTIFICATE");
  expect(signed.stderr).toContain("APPLE_CERTIFICATE");
  expect(validate({ TAURI_SIGNING_PRIVATE_KEY: "" }).status).not.toBe(0);
  expect(
    validate({ RELEASE_PLATFORMS: "android,windows,macos" }).stderr,
  ).toContain("ANDROID_KEYSTORE_BASE64");
});
