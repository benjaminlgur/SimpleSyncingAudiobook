const { getSentryExpoConfig } = require("@sentry/react-native/metro");
const { withNativeWind } = require("nativewind/metro");
const path = require("node:path");
// Expo owns monorepo resolution; forcing every nested dependency through the
// root node_modules mixes incompatible native and desktop SDK versions.
const config = getSentryExpoConfig(__dirname);
config.watchFolders = [
  ...new Set([...config.watchFolders, path.resolve(__dirname, "../..")]),
];

module.exports = withNativeWind(config, { input: "./global.css" });
