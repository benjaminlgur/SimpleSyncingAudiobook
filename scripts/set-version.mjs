import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) throw new Error("Provide a version such as 1.0.0 (without v)");
const root = fileURLToPath(new URL("../", import.meta.url));
for (const file of ["package.json", "packages/shared/package.json", "apps/desktop/package.json", "apps/mobile/package.json", "apps/desktop/src-tauri/tauri.conf.json", "apps/mobile/app.json"]) {
  const path = resolve(root, file);
  const data = JSON.parse(readFileSync(path, "utf8"));
  (data.expo ?? data).version = version;
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}
const cargoPath = resolve(root, "apps/desktop/src-tauri/Cargo.toml");
writeFileSync(cargoPath, readFileSync(cargoPath, "utf8").replace(/^(version = ")[^"]+(")/m, `$1${version}$2`));
const lockPath = resolve(root, "apps/desktop/src-tauri/Cargo.lock");
writeFileSync(lockPath, readFileSync(lockPath, "utf8").replace(/(name = "audiobook-desktop"\r?\nversion = ")[^"]+(")/, `$1${version}$2`));
