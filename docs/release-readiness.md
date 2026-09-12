# Release configuration and validation

The tagged release workflow validates signing configuration before deploying the
backend or creating the release. It creates a draft release for review. Do not
change signing identities between releases installed by the same users.

## Required signing configuration

Set these GitHub Actions repository secrets:

| Secret | Value |
| --- | --- |
| `CONVEX_DEPLOY_KEY_PROD` | Production Convex deploy key |
| `ANDROID_KEYSTORE_BASE64` | Base64 of the existing release/upload keystore |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Release key alias |
| `ANDROID_KEY_PASSWORD` | Release key password |
| `WINDOWS_CERTIFICATE` | Base64 PFX containing the Windows signing certificate and key |
| `WINDOWS_CERTIFICATE_PASSWORD` | PFX password |
| `APPLE_CERTIFICATE` | Base64 Developer ID Application certificate and private key |
| `APPLE_CERTIFICATE_PASSWORD` | Certificate export password |
| `APPLE_SIGNING_IDENTITY` | Full Developer ID Application signing identity |
| `APPLE_ID` | Apple developer account email |
| `APPLE_PASSWORD` | App-specific password used by notarization |
| `APPLE_TEAM_ID` | Apple developer team ID |
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri updater signing private key |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Updater key password, if encrypted |

Set repository variables `HOSTED_CONVEX_URL` and `TAURI_UPDATER_PUBLIC_KEY`.
`RELEASE_PLATFORMS` selects a comma-separated subset of `android,linux,windows,macos`;
when absent, all four are required. Signing checks apply to every selected
platform. The initial v1.0.2 release selects `android,linux` while Windows and macOS
certificates are pending. Linux packages use the signed Tauri updater artifacts.
Use a certificate compatible with the configured Windows certificate-store
signing flow; hardware-backed signing services need their provider's signing
integration instead of an exportable PFX.

Android signing is implemented as an Expo config plugin, so clean prebuilds keep
the signing configuration. Keystore material is decoded into runner temporary
storage and removed after the build. The release produces and verifies both APK
and AAB signatures. Missing release credentials fail the Gradle release task;
debug builds continue to work with a development key. The version-bump script
increments Android's `versionCode` when the app version changes.

The pipeline cannot make an old debug-signed APK upgrade-compatible with a
release-signed APK. Verify the installed certificate before distributing an
upgrade to existing users; imported audio must be preserved before any uninstall.

## Updates and crash reporting

Desktop release builds embed the updater public key and the repository's published
`latest.json` endpoint. Tauri creates signed updater artifacts, and the GitHub
action assembles the update manifest. Only published releases become visible.
The desktop checks on startup, offers installation, pauses and saves playback
before restarting, and verifies updater signatures.

Mobile includes `expo-updates`. Set repository variable `EXPO_UPDATE_URL` to an
HTTPS Expo Updates-compatible endpoint (for example an existing EAS Update
project). Updates are disabled when this is absent. Runtime fingerprints prevent
JavaScript updates being loaded into incompatible native builds. A new native
dependency or SDK requires a new APK/AAB; it cannot be delivered by an OTA update.
Settings can download an update and restart after saving playback.

For Sentry, set repository variables `DESKTOP_SENTRY_DSN`, `MOBILE_SENTRY_DSN`,
`SENTRY_ORG`, `DESKTOP_SENTRY_PROJECT`, and `MOBILE_SENTRY_PROJECT`, and the secret
`SENTRY_AUTH_TOKEN` for source-map uploads. DSNs are public client configuration;
the auth token is build-only. Desktop uploads source maps through the Sentry Vite
plugin and removes them from the distribution. Mobile uses the Sentry Expo/Metro
and native build integrations. Reporting is disabled without a DSN. Events strip
request data, users, breadcrumbs, extra data, and exception messages to avoid
uploading tokens, local paths, or audiobook titles. Shared sync diagnostics log
stable event names and error types rather than user data.

No signing certificates, Sentry projects, or update service accounts are created
by these source changes. Configure the services before publishing.

## Expo compatibility decision

Mobile is upgraded from Expo SDK 52 to **54.0.37**, React Native **0.81.5**, and
React **19.1.0**. SDK 54 is the last Expo version supporting the legacy native
architecture used by Track Player 4. Reanimated stays on compatible **3.19.5**;
its Expo version-check exclusion is intentional. Track Player has a checked-in
pnpm patch for React Native's stricter nullable Bundle annotations. Legacy file
system APIs are imported explicitly from `expo-file-system/legacy`.

SDK 57 is current, but migration to it remains a separate playback-engine
replacement: Track Player 5 changes the API and license, and Expo's playlist API
does not expose the same lock-screen controls. Do not remove the architecture
setting or replace dependency versions alone.

References: [Expo SDK 54](https://expo.dev/changelog/sdk-54),
[Track Player's architecture and license](https://github.com/doublesymmetry/react-native-track-player),
[Reanimated compatibility](https://docs.swmansion.com/react-native-reanimated/docs/3.x/guides/compatibility/),
[Tauri updater signing](https://v2.tauri.app/plugin/updater/).

## Verification

`pnpm verify` checks source UTF-8, client lint, TypeScript, regression tests,
desktop production bundling, and Android JavaScript export. `pnpm format:check`
checks the formatter baseline. `cargo test --lib --locked` tests native audio
helpers. A clean Expo prebuild plus Android assembly verifies native compatibility
and that signing survives generation.

Tests cover stale offline listening for 5 seconds, 2 minutes, and 5 minutes,
both reconnect/query arrival orders, and legacy local positions. A newer local
timestamp never grants permission to overwrite a newer cloud revision. A conflict
retains both positions and requires an explicit choice. Delayed/failed native
seeks and stale in-flight native reads cannot acquire the cloud revision and then
publish old progress under it.

Physical-device background audio, notification controls, OS keyring behavior,
Windows certificate signing, and macOS notarization still need platform validation
with the release credentials. A JavaScript export alone does not validate these.

Local validation on September 11, 2026 passed the full `pnpm verify` suite,
formatter checks, three Rust tests, clean Expo Android prebuild, and Track Player's
native Kotlin compilation. The generated Gradle release task was also checked to
reject missing signing credentials. A subsequent desktop restore-cancellation
regression test passed, bringing the client/shared/backend test total to 79.
Full Android debug assembly remains unverified: repeated attempts encountered
Windows Gradle 8.14.3 cache errors moving temporary transform workspaces. Run
native assembly on a clean CI runner before distributing a release.
