// @vitest-environment node
import { test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

test("version bumps distinguish mobile package settings from Expo app config and are idempotent", () => {
  const tempRoot = realpathSync(tmpdir());
  const directory = mkdtempSync(join(tempRoot, "audiobook-version-test-"));
  const write = (name: string, value: unknown) => {
    mkdirSync(dirname(join(directory, name)), { recursive: true });
    writeFileSync(
      join(directory, name),
      typeof value === "string" ? value : JSON.stringify(value),
    );
  };
  const read = (name: string) =>
    JSON.parse(readFileSync(join(directory, name), "utf8"));
  try {
    for (const name of [
      "package.json",
      "packages/shared/package.json",
      "apps/desktop/package.json",
      "apps/desktop/src-tauri/tauri.conf.json",
    ])
      write(name, { version: "1.0.1" });
    write("apps/mobile/package.json", {
      version: "1.0.1",
      expo: { install: { exclude: ["react-native-reanimated"] } },
    });
    write("apps/mobile/app.json", {
      expo: { version: "1.0.1", android: { versionCode: 3 } },
    });
    write(
      "apps/desktop/src-tauri/Cargo.toml",
      '[package]\nname = "audiobook-desktop"\nversion = "1.0.1"\n',
    );
    write(
      "apps/desktop/src-tauri/Cargo.lock",
      '[[package]]\nname = "audiobook-desktop"\nversion = "1.0.1"\n',
    );
    mkdirSync(join(directory, "scripts"));
    const script = join(directory, "scripts/set-version.mjs");
    copyFileSync(
      fileURLToPath(new URL("./set-version.mjs", import.meta.url)),
      script,
    );
    execFileSync(process.execPath, [script, "1.0.2"]);
    expect(read("apps/mobile/package.json")).toEqual({
      version: "1.0.2",
      expo: { install: { exclude: ["react-native-reanimated"] } },
    });
    expect(read("apps/mobile/app.json").expo).toEqual({
      version: "1.0.2",
      android: { versionCode: 4 },
    });
    expect(read("package.json").version).toBe("1.0.2");
    expect(
      readFileSync(
        join(directory, "apps/desktop/src-tauri/Cargo.lock"),
        "utf8",
      ),
    ).toContain('version = "1.0.2"');
    execFileSync(process.execPath, [script, "1.0.2"]);
    expect(read("apps/mobile/app.json").expo.android.versionCode).toBe(4);
  } finally {
    if (!realpathSync(directory).startsWith(tempRoot + sep))
      throw new Error("Unexpected temporary directory");
    rmSync(directory, { recursive: true });
  }
});
