# Simple Global Audiobook Player

A multiplatform audiobook player that syncs your listening position across devices using Convex.

## Architecture

- **Desktop**: Tauri 2 + Vite + React + shadcn/ui + Tailwind CSS
- **Mobile (Android)**: Expo + React Native + NativeWind + gluestack-ui
- **Backend**: Convex (position sync, audiobook metadata)
- **Shared**: Pure TypeScript sync engine, checksum utility, types

## Project Structure

```
├── convex/           # Convex backend (schema, mutations, queries)
├── packages/shared/  # Shared logic (sync engine, types, checksum)
├── apps/desktop/     # Tauri 2 desktop app
└── apps/mobile/      # Expo React Native app
```

## Prerequisites

- Node.js 18+
- pnpm (`npm install -g pnpm`)
- Rust toolchain (for Tauri desktop)
- Android SDK (for mobile)
- A Convex account and deployment

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Set up Convex

Create a Convex project at https://dashboard.convex.dev, then:

```bash
npx convex dev
```

This will push the schema and functions to your deployment. Note the deployment URL.

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

## Usage

1. On first launch, enter your Convex deployment URL (e.g., `https://your-project-123.convex.cloud`)
2. Add audiobook folders (desktop) or audio files (mobile) to your library
3. Play audiobooks — your position syncs automatically across all connected devices
4. Works offline — position is saved locally and synced when you're back online

## Sync Behavior

- Local position persists every 2 seconds
- Remote sync every 20 seconds while playing
- Immediate sync on: pause, chapter change, app background, app close
- Offline queue: latest position stored locally, flushed on reconnect
- Manual sync available via the Sync button

## Audiobook Linking

Audiobooks are automatically matched across devices by folder name + file checksum.
If auto-matching fails (different encodings, etc.), you can manually link audiobooks
from the library view.
