const fs = require("node:fs");
function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing release configuration: ${name}`);
  return value;
}
const config = JSON.parse(
  fs.readFileSync("apps/desktop/src-tauri/tauri.conf.json", "utf8"),
);
config.bundle.createUpdaterArtifacts = true;
config.plugins.updater = {
  pubkey: required("TAURI_UPDATER_PUBLIC_KEY"),
  endpoints: [
    "https://github.com/benjaminlgur/SimpleSyncingAudiobook/releases/latest/download/latest.json",
  ],
};
required("TAURI_SIGNING_PRIVATE_KEY");
if (process.platform === "darwin") {
  for (const name of [
    "APPLE_CERTIFICATE",
    "APPLE_CERTIFICATE_PASSWORD",
    "APPLE_SIGNING_IDENTITY",
    "APPLE_ID",
    "APPLE_PASSWORD",
    "APPLE_TEAM_ID",
  ])
    required(name);
  config.bundle.macOS = {
    ...config.bundle.macOS,
    signingIdentity: process.env.APPLE_SIGNING_IDENTITY,
  };
}
if (process.platform === "win32") {
  config.bundle.windows = {
    ...config.bundle.windows,
    certificateThumbprint: required("WINDOWS_CERTIFICATE_THUMBPRINT"),
    digestAlgorithm: "sha256",
    timestampUrl: "http://timestamp.digicert.com",
  };
}
fs.writeFileSync(
  "apps/desktop/src-tauri/tauri.conf.json",
  JSON.stringify(config, null, 2) + "\n",
);
