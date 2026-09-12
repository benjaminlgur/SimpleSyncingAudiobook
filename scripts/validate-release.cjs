const fs = require("node:fs");
const platforms = (
  process.env.RELEASE_PLATFORMS || "android,linux,windows,macos"
)
  .split(",")
  .map((value) => value.trim());
if (
  platforms.some(
    (value) => !["android", "linux", "windows", "macos"].includes(value),
  )
)
  throw new Error(
    "RELEASE_PLATFORMS must contain android,linux,windows,macos selections",
  );
const required = ["HOSTED_CONVEX_URL", "CONVEX_DEPLOY_KEY_PROD"];
if (platforms.includes("android"))
  required.push(
    "ANDROID_KEYSTORE_BASE64",
    "ANDROID_KEYSTORE_PASSWORD",
    "ANDROID_KEY_ALIAS",
    "ANDROID_KEY_PASSWORD",
  );
if (platforms.includes("windows"))
  required.push("WINDOWS_CERTIFICATE", "WINDOWS_CERTIFICATE_PASSWORD");
if (platforms.includes("macos"))
  required.push(
    "APPLE_CERTIFICATE",
    "APPLE_CERTIFICATE_PASSWORD",
    "APPLE_SIGNING_IDENTITY",
    "APPLE_ID",
    "APPLE_PASSWORD",
    "APPLE_TEAM_ID",
  );
const desktopMatrix = {
  include: [
    ...(platforms.includes("linux")
      ? [{ platform: "ubuntu-22.04", args: "" }]
      : []),
    ...(platforms.includes("windows")
      ? [{ platform: "windows-latest", args: "" }]
      : []),
    ...(platforms.includes("macos")
      ? [
          { platform: "macos-latest", args: "--target aarch64-apple-darwin" },
          { platform: "macos-latest", args: "--target x86_64-apple-darwin" },
        ]
      : []),
  ],
};
if (desktopMatrix.include.length)
  required.push("TAURI_UPDATER_PUBLIC_KEY", "TAURI_SIGNING_PRIVATE_KEY");
const missing = required.filter((name) => !process.env[name]);
if (missing.length)
  throw new Error(
    `Release blocked; missing configuration: ${missing.join(", ")}`,
  );
const url = new URL(process.env.HOSTED_CONVEX_URL);
if (url.protocol !== "https:" || !url.hostname.endsWith(".convex.cloud"))
  throw new Error("HOSTED_CONVEX_URL must be an HTTPS Convex cloud deployment");
if (process.env.GITHUB_OUTPUT)
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `desktop_matrix=${JSON.stringify(desktopMatrix)}\nbuild_desktop=${desktopMatrix.include.length > 0}\nbuild_android=${platforms.includes("android")}\n`,
  );
console.log(
  `Required release configuration is present for: ${platforms.join(", ")}.`,
);
