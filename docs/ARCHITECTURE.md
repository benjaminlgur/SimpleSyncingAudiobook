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

## Implemented ownership

`SyncEngine` owns the durable pending position, server revision, operation IDs,
conflicts, and reconciliation. A playback session owns its engine and platform
transport. The desktop application retains its Player subtree when changing
pages; selecting another recording or closing the application disposes it. The
mobile native service owns its session independently of the navigation screen.
`CloudProvider` owns the live authorization capability used by screen queries and
background push adapters, and revokes it on account/provider teardown.

An `audiobooks` row is the catalog recording; `audiobookDeviceCopies` records
which devices have a copy. Local libraries own paths and local chapter labels.
Optional `recordingId` references make migrated progress reads direct; legacy
links are read only to adopt old groups and implement explicit link/unlink edits.
Linking, unlinking, and root removal advance revisions to invalidate stale writes.
Removing a device copy retains the recording and progress. An explicit server
removal detaches local metadata instead of deleting local audio.

Self-hosted access keys protect all public data queries and mutations. Hosted
requests require their authenticated account regardless of supplied keys. Protocol
1 connection checks prevent a new self-hosted client from silently connecting to
an incompatible backend. Shared keys are suited to personal deployments, not
multi-tenant access control; hosted identity is the multi-user path.

## Remaining tradeoffs

The desktop transport is an application-mounted React owner, not a separate OS
service. Closing the desktop application stops playback. Local catalog storage
still uses scoped JSON for a small personal library; a transactional local database
would be appropriate if catalogs grow substantially or imports become concurrent.
No cross-encoding audio alignment is attempted. Adding that would need a separate
edition/timeline mapping model and evidence that positions can be translated.
