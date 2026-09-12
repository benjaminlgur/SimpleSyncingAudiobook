const appleSigningVariables = [
  "APPLE_CERTIFICATE",
  "APPLE_CERTIFICATE_PASSWORD",
  "APPLE_SIGNING_IDENTITY",
  "APPLE_ID",
  "APPLE_PASSWORD",
  "APPLE_TEAM_ID",
];

function desktopSigningMode(env) {
  const mode = env.DESKTOP_SIGNING_MODE || "signed";
  if (!["signed", "unsigned"].includes(mode))
    throw new Error("DESKTOP_SIGNING_MODE must be signed or unsigned");
  return mode;
}

function configureDesktopRelease(config, env, platform) {
  const required = (name) => {
    if (!env[name]) throw new Error(`Missing release configuration: ${name}`);
    return env[name];
  };
  const mode = desktopSigningMode(env);
  config = structuredClone(config);
  config.bundle.createUpdaterArtifacts = true;
  config.plugins = {
    ...config.plugins,
    updater: {
      pubkey: required("TAURI_UPDATER_PUBLIC_KEY"),
      endpoints: [
        "https://github.com/benjaminlgur/SimpleSyncingAudiobook/releases/latest/download/latest.json",
      ],
    },
  };
  required("TAURI_SIGNING_PRIVATE_KEY");
  if (platform === "darwin") {
    if (mode === "signed") {
      for (const name of appleSigningVariables) required(name);
    }
    config.bundle.macOS = {
      ...config.bundle.macOS,
      signingIdentity: mode === "unsigned" ? "-" : env.APPLE_SIGNING_IDENTITY,
    };
  }
  if (platform === "win32") {
    const windows = { ...config.bundle.windows };
    if (mode === "unsigned") {
      delete windows.certificateThumbprint;
      delete windows.signCommand;
      delete windows.digestAlgorithm;
      delete windows.timestampUrl;
    } else {
      windows.certificateThumbprint = required(
        "WINDOWS_CERTIFICATE_THUMBPRINT",
      );
      windows.digestAlgorithm = "sha256";
      windows.timestampUrl = "http://timestamp.digicert.com";
    }
    config.bundle.windows = windows;
  }
  return config;
}

module.exports = {
  appleSigningVariables,
  desktopSigningMode,
  configureDesktopRelease,
};
