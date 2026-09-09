# Changelog

## 1.0.1

- Prevent offline playback restored from an older cache without a revision from silently overwriting cloud progress during upgrade. Reconnecting now requires an explicit choice between local and cloud positions.
- Add four integration regressions covering stale offline listening with legacy and versioned progress, with either the cloud read or the upload arriving first. Verify that continued listening cannot bypass the conflict and choosing cloud progress seeks to the saved position.
- Increment the Android build version for the patch update.

**Upgrade:** Install 1.0.1 on every device. The fix is in the shared desktop and mobile client; updating only the backend does not fix installed 1.0.0 clients. No schema migration is required.

## 1.0.0

- Open saved libraries and resume locally while cloud authentication reconnects.
- Keep desktop playback alive while browsing the library or settings, and retain mobile service ownership of synchronization.
- Replace device-clock conflict resolution with server revisions and idempotent session operations. Divergent offline progress is preserved until you choose which position to keep.
- Restore any of the last 20 cloud positions from the player.
- Stream desktop audio from disk and read metadata through bounded random access instead of loading entire books into memory.
- Identify new imports using ordered SHA-256 file fingerprints, independent of display names. Keep existing IDs and adopt recording references lazily.
- Store mobile picker imports in app documents and migrate mobile authentication tokens into SecureStore.
- Require self-hosted access keys by default; store keys in platform credential stores. Validate the server protocol during setup.
- Retain cloud progress when removing a device copy and preserve remaining linked copies when deleting a recording root.
- Expand regression and integration coverage, add checks on main and pull requests, and validate production frontend bundles before release deployment.

**Upgrade:** Deploy the backend first and upgrade all devices together. Existing data is preserved through additive schema changes. After a recording adopts version 1 revisions, older clients can read it but cannot write progress. Self-hosted deployments need `SYNC_ACCESS_KEY` (at least 32 random characters) and clients must reconnect with that key. See the README for migration and rollback details.

## 0.4.5

- Resume from the newest saved position, including progress made offline.
- Keep a local resume position after successful synchronization and protect it from delayed responses.
- Save and sync desktop progress when leaving the player, closing the window, or backgrounding the app.
- Keep mobile synchronization running outside the player screen and respond to notification playback controls.
- Save desktop seeks and chapter changes while paused.
- Read embedded chapter titles and boundaries when importing M4B files on desktop. Single-file books share absolute playback offsets with mobile and older clients.
- Keep all linked audiobook copies on the same position, including existing link chains and cycles. Unlinking retains the last shared position.
- Add regression tests and require passing tests and type checks before release deployment.

Self-hosted users should deploy the updated Convex backend alongside the app update. Hosted backend deployment is part of the release workflow.
