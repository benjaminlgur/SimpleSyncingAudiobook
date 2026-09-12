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
when absent, all four are selected. `DESKTOP_SIGNING_MODE` defaults to `signed`,
which requires the Windows and Apple credentials for selected platforms. Set it
to `unsigned` to build Windows installers without Authenticode and macOS
installers with an ad-hoc signature and no notarization. Users will encounter OS
security prompts. Android release signing and Tauri updater signatures remain
mandatory in either mode. The initial v1.0.2 and v1.0.3 publications selected
`android,linux`; later desktop artifacts can be added without moving those tags.
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

The `Desktop release artifacts` workflow accepts an existing `release_tag` and
builds Windows x64, Apple Silicon, and Intel Mac installers in unsigned mode.
It checks out app code from the tag and packaging scripts from the workflow
commit, records both commit IDs, and uploads CI artifacts for verification.
After checking signatures and hashes, add the new assets to that release and
merge their updater entries into its existing `latest.json`, preserving the
other platforms. This workflow does not overwrite published assets itself.

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

OS keyring behavior with stored credentials, signed installation/update flows,
Windows certificate signing, and macOS notarization still need validation with
the release credentials. A JavaScript export alone does not validate these.

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

### Native Android validation

For the Expo 57 branch, `apps/mobile/native-tests/playerSmoke.ts` exercises the
actual native player rather than mocks. It checks a cloud seek queued before
setup, chapter/position acknowledgement, advancing playback, speed, pause,
native state/progress events, chapter switching, and saving on stop. Prepare a
disposable project with `node scripts/prepare-native-player-smoke.mjs`. In
`.native-validation/player-smoke`, run Expo prebuild and an Android debug build,
then start Metro from that same directory and launch the generated smoke app.
Look for `PLAYER_SMOKE: PASS` in Android logcat. The fixture uses a generated
silent WAV, memory storage, a separate application ID, and no Convex connection.

On September 12, the ARM64 debug build passed and was installed as the separate
`com.simplesyncing.audiobook.smoke` app on a Samsung SM-S918U1 running Android 16.
Two unchanged warm launches passed all native smoke assertions. An additional
session continued playing for over a minute in the background, including track
repeat. Tapping the actual Android notification's Pause and Play controls emitted
the corresponding remote events and changed native playback state correctly.
The existing app's installation metadata remained unchanged; test processes and
USB forwarding were cleaned up. The separate smoke app remains installed.

The initial launch exceeded the smoke test's polling deadline despite continuously
advancing native progress events. Its cause remains unestablished; the two later
passes do not establish that the initial timing issue is resolved. These initial
tests used silent audio and stubbed cloud persistence. Audible output, real
cross-device cloud sync, screen lock, Bluetooth, long-duration battery/Doze
behavior, and a release-signed upgrade were not exercised. Local evidence is
under `.native-validation/physical-android/RESULTS.md` and its accompanying logs.

For this Windows physical-device session, Metro also needed `EXPO_OFFLINE=1` and
`CI=1` alongside IPv4 localhost. CI mode avoids a workspace file-watcher startup
timeout; it serves the bundle without watching for subsequent edits.

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

### Real cross-device validation

Later on September 12, the Windows native app and the physical Samsung phone
ran the production library/player screens against the real Convex development
deployment in self-hosted mode. Separate app profiles and generated test books
kept this work isolated from the user's installed app and listening library.
The phone used the existing ARM64 smoke APK with the production app routes;
its disposable Expo bootstrap supplied an explicit route context.

This testing found and fixed four problems:

- Desktop registration callbacks changed during connection notifications,
  restarting pending registrations until Convex closed the overloaded socket.
- The shared connection lifecycle briefly denied writes from child effects
  immediately after reporting that the connection was ready.
- Folder position conversion leaked local cache fields into cloud mutations,
  overwriting the cloud audiobook ID and causing validation failures.
- Clean restored progress could retain a misleading "Not synced" label. Cloud
  confirmation now updates that status after persistence and any required seek,
  without masking errors or newer local edits.

The final checks passed:

- Both devices computed the same recording fingerprint and cloud identity.
- Windows' chapter 1 / 0:30 resumed on Android; Android played and paused at
  55.047 seconds, and Windows received that position while its player was hidden
  by the library. A subsequent chapter 2 / 0:30 handoff also passed.
- With only the phone test app's sync transport blocked, its local 1:00 position
  stayed unsynced while Windows saved 1:30. Reconnecting showed both positions
  in the conflict UI; "Use other device" moved native playback to 1:30 without
  overwriting the server revision. A separate stale-revision mutation with a
  future client clock was also rejected.
- An M4B with two embedded chapters on Windows and one track on Android resumed
  at the same absolute offset. Rewinding on Android crossed the desktop's chapter
  boundary correctly. Both devices preserved the position across restart.
- Final fresh launches showed the correct paused 0:30 position and "Synced"
  without creating another server revision.

Validation passed 92 tests, the full project typecheck, changed-file lint and
format checks, the production desktop bundle, and the Windows native debug
build. Test processes and USB forwarding were stopped. Both temporary cloud
books were removed after checking their IDs, names and fingerprints, other
books matched the pre-cleanup snapshot, and the temporary development access
key was revoked. The separate test APK/profile and generated local media remain.

Google-authenticated hosted mode, screen lock, Bluetooth, long-duration battery
or Doze behavior, and a release-signed upgrade were not covered by this session.
The earlier initial smoke-test timing observation remains recorded above.
Evidence is in `.native-validation/cross-device/RESULTS.md` and
`.native-validation/physical-android/cross-device/RESULTS.md`.

### v1.0.3 publication

The Expo 57 upgrade and cross-device fixes were merged into `main` and published
as [v1.0.3](https://github.com/benjaminlgur/SimpleSyncingAudiobook/releases/tag/v1.0.3)
on September 12, 2026, from commit `937dad6`. The complete release workflow passed,
including production Convex deployment, Linux native tests and packages, and
the signed Android APK and app bundle.

All nine downloaded assets matched GitHub's SHA-256 digests. The Android APK
reports version 1.0.3 / version code 4, includes all four Android architectures,
and uses the same signing certificate as v1.0.2. The app bundle signature also
verified. AppImage, Debian, and RPM updater signatures verified against the
existing public key, and modified packages were rejected. The public latest
release and updater endpoint both resolve to v1.0.3.

Windows and macOS installers were excluded from the initial publication by the
workflow's certificate requirement. The device-test limitations above still apply; artifact
verification does not add a release-signed upgrade installation test.
