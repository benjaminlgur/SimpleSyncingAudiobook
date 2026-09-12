import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = path.join(root, "apps/mobile");
const destination = path.join(root, ".native-validation/player-smoke");
const excluded = new Set(["node_modules", "android", "ios", "dist", ".expo"]);
fs.cpSync(source, destination, {
  recursive: true,
  filter: (file) =>
    !path
      .relative(source, file)
      .split(path.sep)
      .some((part) => excluded.has(part)),
});

// Silent PCM keeps the fixture local, deterministic, and free of copyrighted audio.
const rate = 8000;
const wav = Buffer.alloc(44 + rate * 65 * 2);
wav.write("RIFF", 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24);
wav.writeUInt32LE(rate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(wav.length - 44, 40);
fs.writeFileSync(path.join(destination, "assets/native-smoke.wav"), wav);

const pkg = JSON.parse(
  fs.readFileSync(path.join(source, "package.json"), "utf8"),
);
pkg.main = "native-smoke.tsx";
// Gradle watches this package.json; the workspace lockfile lives outside the
// disposable app. Invalidate native autolinking when a pnpm patch changes.
pkg.nativeSmokeDependencyHash = createHash("sha256")
  .update(fs.readFileSync(path.join(root, "pnpm-lock.yaml")))
  .digest("hex");
fs.writeFileSync(
  path.join(destination, "package.json"),
  JSON.stringify(pkg, null, 2) + "\n",
);
const config = JSON.parse(
  fs.readFileSync(path.join(source, "app.json"), "utf8"),
);
config.expo.name += " Smoke Test";
config.expo.android.package += ".smoke";
config.expo.ios.bundleIdentifier += ".smoke";
fs.writeFileSync(
  path.join(destination, "app.json"),
  JSON.stringify(config, null, 2) + "\n",
);
fs.writeFileSync(
  path.join(destination, "native-smoke.tsx"),
  `
import React, { useEffect } from "react";
import { registerRootComponent } from "expo";
import { Asset } from "expo-asset";
import TrackPlayer from "react-native-track-player";
import { PlaybackService } from "./lib/trackPlayerService";
import { runNativePlayerSmoke } from "./native-tests/playerSmoke";

TrackPlayer.registerPlaybackService(() => PlaybackService);
function NativeSmoke() {
  useEffect(() => {
    void Asset.fromModule(require("./assets/native-smoke.wav")).downloadAsync()
      .then(asset => runNativePlayerSmoke(asset.localUri ?? asset.uri))
      .catch(error => console.error("PLAYER_SMOKE: FAIL", error.stack ?? error.message));
  }, []);
  return null;
}
registerRootComponent(NativeSmoke);
`,
);
console.log(`Prepared native playback fixture in ${destination}`);
console.log("This fixture uses memory storage and never connects to Convex.");
