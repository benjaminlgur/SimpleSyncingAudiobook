const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const {
  appleSigningVariables,
  desktopSigningMode,
  configureDesktopRelease,
} = require("./desktop-signing.cjs");
const config = configureDesktopRelease(
  JSON.parse(fs.readFileSync("apps/desktop/src-tauri/tauri.conf.json", "utf8")),
  process.env,
  process.platform,
);
fs.writeFileSync(
  "apps/desktop/src-tauri/tauri.conf.json",
  JSON.stringify(config, null, 2) + "\n",
);

// Only authenticated macOS releases pass Apple credentials to the build step.
// Ad-hoc builds leave these variables absent, including notarization settings.
if (
  process.platform === "darwin" &&
  desktopSigningMode(process.env) === "signed" &&
  process.env.GITHUB_ENV
) {
  for (const name of appleSigningVariables) {
    const delimiter = randomUUID();
    fs.appendFileSync(
      process.env.GITHUB_ENV,
      `${name}<<${delimiter}\n${process.env[name]}\n${delimiter}\n`,
    );
  }
}
