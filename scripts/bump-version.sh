#!/bin/bash
set -euo pipefail

VERSION=${1:-}

if [ -z "$VERSION" ]; then
  echo "Usage: ./scripts/bump-version.sh <version>"
  echo "Example: ./scripts/bump-version.sh 1.0.0"
  exit 1
fi

if [[ "$VERSION" == v* ]]; then
  echo "Error: provide version without 'v' prefix (e.g. 1.0.0, not v1.0.0)"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT_DIR"
node scripts/set-version.mjs "$VERSION"
pnpm verify
(cd apps/desktop/src-tauri && cargo test --lib --locked)
git add package.json packages/shared/package.json apps/desktop/package.json apps/mobile/package.json apps/desktop/src-tauri/tauri.conf.json apps/mobile/app.json apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock
git commit -m "release: v$VERSION"
git tag "v$VERSION"
git push origin main
git push origin "v$VERSION"

echo ""
echo "Tagged and pushed v$VERSION — release build started!"
echo "Watch the build: https://github.com/benjaminlgur/SimpleSyncingAudiobook/actions"
