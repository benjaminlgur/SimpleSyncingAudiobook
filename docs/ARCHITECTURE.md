# Architecture and the 1.0 upgrade

The product is a local audiobook player with account-scoped cloud progress. Audio
belongs to the device; Convex stores catalog metadata and synchronization state.
React/Expo are presentation and platform adapters, and shared TypeScript owns
the synchronization protocol. Tauri provides native disk access on desktop.

## Upgrade sequence

1. Replace whole-file desktop playback and metadata reads with file-backed range
   access. Fingerprint new imports using SHA-256 of their ordered file contents.
2. Introduce server revisions, durable pending progress, explicit conflict
   resolution, and bounded recovery history. Preserve legacy positions and IDs;
   adopt them lazily, without a destructive bulk migration.
3. Keep desktop playback mounted at application scope, restore local playback
   immediately, and allow previously authenticated accounts to open cached local
   libraries while reconnecting. Explicit logout clears the remembered account.
4. Validate the upgrade, document compatibility, run cross-platform release
   builds, and publish 1.0 only after the release checks pass.

## Boundaries and limitations

Content fingerprints identify identical ordered files, not semantic editions.
Re-encoded files and different narrations must not be automatically merged.
Manual links assert a compatible timeline and require the user's judgment.
Existing imports retain their identifiers and progress until re-imported.

Client timestamps are display metadata in the new protocol, never authority for
overwriting progress. An offline fork is retained until its owner chooses local
or remote progress. Server revisions serialize writes and retries are idempotent.

Cached account scopes authorize local access only; server identity remains the
authority for every network request. Local files and cached metadata are subject
to the operating system user's access controls.
