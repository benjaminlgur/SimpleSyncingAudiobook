# Release configuration and validation

The tagged release workflow validates signing configuration before deploying the
backend or creating the release. It creates a draft release for review. Do not
change signing identities between releases installed by the same users.

## Required signing configuration

Set these GitHub Actions repository secrets:

| Secret                               | Value                                                         |
| ------------------------------------ | ------------------------------------------------------------- |
| `CONVEX_DEPLOY_KEY_PROD`             | Production Convex deploy key                                  |
| `ANDROID_KEYSTORE_BASE64`            | Base64 of the existing release/upload keystore                |
| `ANDROID_KEYSTORE_PASSWORD`          | Keystore password                                             |
| `ANDROID_KEY_ALIAS`                  | Release key alias                                             |
| `ANDROID_KEY_PASSWORD`               | Release key password                                          |
| `WINDOWS_CERTIFICATE`                | Base64 PFX containing the Windows signing certificate and key |
| `WINDOWS_CERTIFICATE_PASSWORD`       | PFX password                                                  |
| `APPLE_CERTIFICATE`                  | Base64 Developer ID Application certificate and private key   |
| `APPLE_CERTIFICATE_PASSWORD`         | Certificate export password                                   |
| `APPLE_SIGNING_IDENTITY`             | Full Developer ID Application signing identity                |
| `APPLE_ID`                           | Apple developer account email                                 |
| `APPLE_PASSWORD`                     | App-specific password used by notarization                    |
| `APPLE_TEAM_ID`                      | Apple developer team ID                                       |
| `TAURI_SIGNING_PRIVATE_KEY`          | Tauri updater signing private key                             |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Updater key password, if encrypted                            |

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

Android packaging uses a reusable workflow with a 4 GB heap, 2 GB metadata limit,
and two Gradle workers. It can also be dispatched manually with `release_tag` to
retry an existing draft release without moving the tag or rebuilding desktop
installers. The retry checks out that exact tag and refuses published releases.

The pipeline cannot make an old debug-signed APK upgrade-compatible with a
release-signed APK. Verify the installed certificate before distributing an
upgrade to existing users; imported audio must be preserved before any uninstall.

## Updates and crash reporting

Desktop release builds embed the updater public key and the repository's published
`latest.json` endpoint. Tauri creates signed updater artifacts, and the GitHub
action assembles the update manifest. Only published releases become visible.
The desktop checks on startup, offers installation, pauses and saves playback
before restarting, and verifies updater signatures.
Local builds without updater configuration skip native updater registration so
they can start before release credentials are configured.

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

The published **v1.0.2** release uses Expo SDK 54. The upgrade branch moves to
**Expo 57.0.22**, **React Native 0.86.3**, and **React 19.2.3**, with Reanimated
**4.5.1** and Worklets **0.10.1**. Expo's new architecture is enabled by default.
TypeScript moves to the Expo-recommended **6.0.3**; explicit ambient types and
CSS declarations replace its previous implicit type discovery.

Track Player **4.1.2** remains the latest Apache-licensed version. Its native
compatibility is upgraded with a checked-in pnpm patch: asynchronous Android
React methods return JVM `void` through a Unit-returning coroutine helper, and
service events use `ReactApplication.reactHost.currentReactContext`. The patch
also retains the nullable Bundle fixes. This uses React Native's legacy-module
interop; it is not a Track Player 5 migration. The existing promise-based seek
and background-service APIs remain in use.

Track Player 5 changes both API and license. Its terms require a commercial
license for organizational use, including nonprofits. The upgrade branch keeps
the Apache player rather than adding those terms to the application. iOS audio
background mode is now explicit in app configuration. Legacy filesystem calls
remain imported from `expo-file-system/legacy`.

References: [Expo SDK 57](https://expo.dev/changelog/sdk-57),
[Track Player's architecture and license](https://github.com/doublesymmetry/react-native-track-player),
[React Native's new architecture](https://docs.expo.dev/guides/new-architecture/),
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
The September 12 v1.0.2 release subsequently passed native Android APK/AAB and
Linux builds in GitHub Actions. The downloaded APK and AAB matched the project's
release certificate, the Linux updater signature verified, and the public
updater manifest resolves v1.0.2. A version-script regression test on main brings
the automated test total to 80.

### Windows desktop interaction validation (September 12)

The Expo 57 branch was built as a native Windows Tauri application and exercised
with Windows computer use. A separate application identifier and WebView profile
held a saved offline connection and generated audio; these checks did not use an
account or modify the user's audiobook library.

Verified through the native UI:

- Importing a folder containing two WAV chapters using the Windows folder picker.
- Playback, pause, forward/backward 30-second seeks, scrubbing, speed selection,
  chapter selection, and continued playback while visiting the library.
- Closing during playback and restoring chapter two at 1:30, paused, on restart.
- M4B import with metadata both before and after the audio payload, including two
  embedded chapter names and their durations; automatic chapter transition and
  restoration of chapter two at 0:25 after restarting.
- Light-theme selection and persistence, and a recoverable update-check failure
  in the local build without a configured updater.

The interaction tests found and fixed a local-build updater initialization crash,
the random-access tokenizer's missing `setPosition` method, and unsupported M4B
chapter layouts. The desktop now reads explicit Nero `chpl` chapter lists with
bounded reads and keeps the existing parser for other metadata. This handles
metadata after `mdat` and grouped chapter samples without buffering the audio.
Format reference: [FFmpeg's chapter-list reader](https://github.com/FFmpeg/FFmpeg/blob/master/libavformat/mov.c).
Previously imported library entries retain their existing chapter metadata.

After these fixes, all **86** automated tests, desktop TypeScript/production
build, targeted lint/format checks, three Rust tests, and the native Windows
debug build passed. Live account authentication, real cloud synchronization, and
signed Windows installer/update installation were not part of this isolated UI
test. The upgrade branch and these desktop fixes remain unreleased.

For the Expo 57 branch, `apps/mobile/native-tests/playerSmoke.ts` exercises the
actual native player rather than mocks. It checks a cloud seek queued before
setup, chapter/position acknowledgement, advancing playback, speed, pause,
native state/progress events, chapter switching, and saving on stop. Prepare a
disposable project with `node scripts/prepare-native-player-smoke.mjs`. In
`.native-validation/player-smoke`, run Expo prebuild and an Android debug build,
then start Metro from that same directory and launch the generated smoke app.
Look for `PLAYER_SMOKE: PASS` in Android logcat. The fixture uses a generated
silent WAV, memory storage, a separate application ID, and no Convex connection.

Expo Doctor still flags the upstream `react-native-track-player` package as
unsupported on the new architecture. Its registry metadata does not describe
this local patch, so the warning remains visible and native playback validation
is required when changing React Native or the player patch.

On Windows, Android's bundled Ninja 1.10.2 can fail in Worklets with
`build.ninja still dirty after 100 tries`. The optional
`scripts/windows-native-build.init.gradle` selects a newer Ninja executable and
puts CMake intermediates in shorter paths inside the Android project. Set
`NINJA_PATH` to a Ninja 1.12+ executable and add
`-I ../../../scripts/windows-native-build.init.gradle` to the Gradle command
when running from the generated Android directory. This leaves the global SDK
installation unchanged. See the upstream
[Windows build guide](https://docs.swmansion.com/react-native-reanimated/docs/guides/building-on-windows/).

Expo 57 validation on September 12, 2026 passed `pnpm verify` (80 tests), the
dependency version check, Android prebuild, and an x86_64 Android debug build
using Ninja 1.13.2 with the Windows override. Every compiled asynchronous player
method was checked for a JVM `void` return. The native smoke test passed on an
Android API 36 emulator with Fabric enabled, including actual seeks, playback,
speed changes, pause, event delivery, and saved progress. The release task also
rejected missing signing credentials as intended. Expo Doctor passes 20 of 21
checks, with only the documented upstream player metadata warning remaining.
The regular app also reached its sign-in and connection screen on the emulator.

If Windows binds Metro only to IPv6 localhost, start it using
`node --dns-result-order=ipv4first ../../node_modules/expo/bin/cli start --localhost --max-workers 2`
from the disposable app directory, and use `adb reverse tcp:8081 tcp:8081` for the
test emulator. This avoids changing system network settings.
