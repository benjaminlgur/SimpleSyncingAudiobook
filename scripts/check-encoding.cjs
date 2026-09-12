const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const decoder = new TextDecoder("utf-8", { fatal: true });
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
).split("\0");
for (const file of new Set(files)) {
  if (!/\.(tsx?|jsx?|mjs|cjs|json|md|ya?ml|rs)$/.test(file)) continue;
  decoder.decode(readFileSync(file));
}
console.log("Source files are valid UTF-8.");
