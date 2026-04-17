# Simple Syncing Audiobook

Simple Syncing Audiobook is a multiplatform app that syncs your listening
position across devices using Convex. Its disined to be lightweight and low cost where users bring their own audiobook files.

## Architecture

- **Desktop**: Tauri 2 + Vite + React + shadcn/ui + Tailwind CSS
- **Mobile (Android)**: Expo + React Native + NativeWind + gluestack-ui
- **Backend**: Convex (position sync, audiobook metadata)
- **Shared**: Pure TypeScript sync engine, checksum utility, types

## Project Structure

```text
.
|- convex/           # Convex backend (schema, mutations, queries)
|- packages/shared/  # Shared logic (sync engine, types, checksum)
|- apps/desktop/     # Tauri 2 desktop app
`- apps/mobile/      # Expo React Native app
```

## Prerequisites

- Node.js 18+
- pnpm (`npm install -g pnpm`)
- A Convex account
- Rust toolchain (for Tauri desktop)
- Android SDK (for mobile)

## Setup

### 1. Install dependencies

Run from the repository root:

```bash
pnpm install
```

### 2. Set up your personal Convex backend

Most users should use their own Convex deployment. This mode does not use
Google sign-in, does not enforce the hosted usage limits, and stores all synced
data in the Convex project you control.

Run this from the repository root:

```bash
npx convex dev --once
```

On the first run, the Convex CLI prompts you to log in and create or select a
project. It then pushes this repo's schema and functions and writes deployment
details to `.env.local`.

Copy the **Convex cloud URL** for your deployment:

```text
https://your-project-123.convex.cloud
```

You can find it in one of these places:

- the `CONVEX_URL` value in the generated `.env.local`
- the Convex CLI output after `npx convex dev --once`
- the Convex dashboard for your deployment

Paste that `.convex.cloud` URL into the app setup screen on each device. Do not
paste the `.convex.site` URL; that site URL is only used for hosted Google
OAuth callbacks.

For a personal backend, leave `REQUIRE_AUTH` unset or set to anything other
than `true`. Setting `REQUIRE_AUTH=true` turns on hosted-auth behavior and will
make the unauthenticated "bring your own URL" flow fail.

Useful Convex commands:

| Command | When to use it |
|---|---|
| `npx convex dev` | Keep Convex running while developing backend changes |
| `npx convex dev --once` | Push backend changes once for local testing |
| `npx convex deploy` | Deploy backend changes to a production Convex deployment |

Because personal mode has no authentication, treat the Convex URL as your sync
endpoint. Anyone who has the URL can call this app's public Convex functions for
that deployment.

### 3. Run the desktop app

```bash
cd apps/desktop
pnpm tauri dev
```

### 4. Run the mobile app

```bash
cd apps/mobile
npx expo prebuild
npx expo run:android
```

## Connection Modes

The app supports two ways to connect:

- **Sign in with Google**: uses a shared hosted Convex deployment with
  authentication, per-user data isolation, and usage limits (200 audiobooks,
  10 devices). Regular app users do not need to set up Convex for this mode.
- **Bring your own Convex URL**: the user creates their own Convex deployment
  and pastes its `.convex.cloud` URL. This mode has no auth, no app-enforced
  limits, and full control over the synced data.

Both options appear on the setup screen. The Google option only shows in builds
where `VITE_HOSTED_CONVEX_URL` (desktop) or `EXPO_PUBLIC_HOSTED_CONVEX_URL`
(mobile) is configured.

## Usage

1. On first launch, sign in with Google or enter your own Convex deployment URL.
2. Add audiobook folders on desktop, or select a folder / M4B file on mobile.
3. Play audiobooks. Your position syncs automatically across connected devices.
4. Work offline. Position is saved locally and synced when you're back online.

## Sync Behavior

- Local position persists every 2 seconds
- Remote sync every 20 seconds while playing
- Immediate sync on: pause, chapter change, app background, app close
- Offline queue: latest position stored locally, flushed on reconnect
- Manual sync available via the Sync button

## Audiobook Linking

Audiobooks are automatically matched across devices by folder name + file
checksum. If auto-matching fails (different encodings, etc.), you can manually
link audiobooks from the library view.

## Hosted Deployment Setup (Google Sign-In)

This section is for maintainers or distributors who want to build the app with
the shared "Sign in with Google" option. Normal users who bring their own Convex
URL can skip this section.

Use a **separate** Convex deployment for hosted Google sign-in. Do not reuse a
personal self-hosted development deployment for the shared hosted backend.

### 1. Create the hosted deployment

Create a new Convex project at https://dashboard.convex.dev. Keep track of both
deployment URLs:

```text
https://your-hosted-project-123.convex.cloud
https://your-hosted-project-123.convex.site
```

Use the `.convex.cloud` URL in app build environment variables. Use the
`.convex.site` URL for Google OAuth redirect setup.

### 2. Create a hosted env file

Create `.env.hosted` at the repo root:

```env
CONVEX_DEPLOYMENT=dev:<your-hosted-deployment-name>
```

Use the deployment name expected by the Convex CLI, not the full URL.

### 3. Push functions to the hosted deployment

```bash
npx convex dev --once --env-file .env.hosted
```

### 4. Set up Google OAuth

1. Go to [Google Cloud Console > Credentials](https://console.cloud.google.com/apis/credentials).
2. Create an OAuth 2.0 Client ID with type **Web application**.
3. Add this Authorized redirect URI, using your hosted `.convex.site` URL:

```text
https://your-hosted-project-123.convex.site/api/auth/callback/google
```

Leave Authorized JavaScript origins blank. Google redirects to Convex first;
Convex then redirects back into the desktop or mobile app.

### 5. Set environment variables on the hosted deployment

In the Convex dashboard for the hosted deployment, add:

| Variable | Value |
|---|---|
| `REQUIRE_AUTH` | `true` |
| `AUTH_GOOGLE_ID` | Your Google OAuth client ID |
| `AUTH_GOOGLE_SECRET` | Your Google OAuth client secret |
| `JWT_PRIVATE_KEY` | Generated Convex Auth private key |
| `JWKS` | Matching JWKS JSON for the private key |
| `SITE_URL` | `http://tauri.localhost` |

`JWT_PRIVATE_KEY` and `JWKS` must be a matching pair. One way to generate and
set the Convex Auth values is:

```bash
pnpm exec auth --deployment-name <your-hosted-deployment-name> --web-server-url http://tauri.localhost
```

This repo already contains the Convex Auth files, so review any file changes if
you run the auth setup command. The important hosted deployment env vars are the
ones listed above.

Keep `SITE_URL` as `http://tauri.localhost` for the desktop Tauri redirect. The
mobile deep link redirect is allowed in `convex/auth.ts`. Do not set `SITE_URL`
to the Convex cloud URL, Convex site URL, or Play Store URL.

### 6. Set local build env vars

In `.env.local` at the repo root:

```env
VITE_HOSTED_CONVEX_URL=https://your-hosted-project-123.convex.cloud
EXPO_PUBLIC_HOSTED_CONVEX_URL=https://your-hosted-project-123.convex.cloud
```

These variables only enable the hosted Google sign-in option in local builds.
They are not required for the personal "bring your own Convex URL" flow.

### 7. Keep deployments in sync

When developing against your personal backend, run:

```bash
npx convex dev
```

After backend changes that should also be available to hosted Google sign-in
users, push the same Convex functions to the hosted deployment:

```bash
npx convex dev --once --env-file .env.hosted
```

## For Maintainers

### Creating a Release

A GitHub Actions workflow automatically builds desktop installers (Windows,
macOS, Linux) and the Android APK when a version tag is pushed. To create a
release:

```bash
./scripts/bump-version.sh 1.0.0
```

This single command:

1. Updates the version in `package.json`,
   `apps/desktop/src-tauri/tauri.conf.json`, and `apps/mobile/app.json`
2. Commits the version bump
3. Creates a git tag (`v1.0.0`)
4. Pushes the commit and tag to GitHub

The tag push triggers the release workflow, which builds and uploads:

| Platform | Artifacts |
|---|---|
| Windows | `.msi`, `.exe` (NSIS installer) |
| macOS (Apple Silicon) | `.dmg` |
| macOS (Intel) | `.dmg` |
| Linux | `.deb`, `.AppImage`, `.rpm` |
| Android | `.apk` |

Once builds finish, a **draft release** appears on the
[Releases page](https://github.com/benjaminlgur/SimpleGlobalAudiobook/releases).
Review it, edit the notes if needed, and click **Publish**.

### Deploying the Backend

Deploy to both the personal/self-hosted and hosted production deployments before
tagging a release:

```bash
npx convex deploy
npx convex deploy --env-file .env.hosted
```

Release builds also require the GitHub Actions repository variable
`HOSTED_CONVEX_URL` to point at the hosted `.convex.cloud` URL, and the secret
`CONVEX_DEPLOY_KEY_PROD` to contain a production deploy key for the hosted
Convex project.
