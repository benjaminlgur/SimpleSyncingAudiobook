const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const tag = process.env.RELEASE_TAG;
const platform = process.env.ARTIFACT_PLATFORM;
if (!/^v\d+\.\d+\.\d+$/.test(tag || "")) throw new Error("Invalid release tag");
if (!["windows-x86_64", "darwin-aarch64", "darwin-x86_64"].includes(platform))
  throw new Error("Invalid artifact platform");
const paths = JSON.parse(process.env.ARTIFACT_PATHS || "[]");
const output = "desktop-artifacts";
fs.mkdirSync(output, { recursive: true });
const names = new Set();
for (const file of paths) {
  if (!fs.statSync(file).isFile()) continue;
  if (!/\.(exe|msi|dmg|app\.tar\.gz)(\.sig)?$/.test(file)) continue;
  let name = path.basename(file).replaceAll(" ", ".");
  if (/\.app\.tar\.gz(\.sig)?$/.test(file)) {
    name = `Simple.Syncing.Audiobook_${tag.slice(1)}_${platform}.app.tar.gz${file.endsWith(".sig") ? ".sig" : ""}`;
  }
  if (names.has(name)) throw new Error(`Duplicate artifact: ${name}`);
  names.add(name);
  fs.copyFileSync(file, path.join(output, name));
}
const requiredExtensions = platform.startsWith("windows")
  ? [".exe", ".exe.sig", ".msi", ".msi.sig"]
  : [".dmg", ".app.tar.gz", ".app.tar.gz.sig"];
for (const extension of requiredExtensions) {
  if (![...names].some((name) => name.endsWith(extension)))
    throw new Error(`Missing ${extension} artifact`);
}
fs.writeFileSync(
  path.join(output, `${platform}-provenance.json`),
  JSON.stringify(
    {
      tag,
      platform,
      appCommit: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      packagingCommit: process.env.PACKAGING_COMMIT,
      signingMode: "unsigned",
      files: [...names],
    },
    null,
    2,
  ) + "\n",
);
console.log(`Staged ${names.size} installers and signatures for ${platform}.`);
