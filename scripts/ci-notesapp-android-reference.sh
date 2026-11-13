#!/usr/bin/env bash
# Builds the reference NotesApp for the flashlight job: the Release APK of a fixed tag, which never
# changes, plus that tag's Maestro flows. The flashlight job measures it alternately with the
# commit's own build on the same emulator, and its CPU, FPS and score against their usual values
# (the median over master's history) say how fast that job's CI machine was. Same idea as
# WatermelonDB 0.28 in the iOS benchmark (docs-website/src/components/PerformanceCharts/metrics.js).
#
# ci.yml caches the output, so this only runs when the tag or this script changes. Bumping the tag
# starts a new reference history: factors only compare runs measured with the same tag.
#
# Usage: bash scripts/ci-notesapp-android-reference.sh <tag>
# Writes build-output/reference/{notesapp-release.apk,maestro/,maestro-commands/,TAG}
set -euo pipefail

TAG=$1
SRC="${RUNNER_TEMP:-$(mktemp -d)}/notesapp-reference-src"

git fetch --depth 1 origin "refs/tags/$TAG:refs/tags/$TAG"
git worktree add --detach "$SRC" "$TAG"

(cd "$SRC" && yarn install --immutable)
(cd "$SRC/examples/NotesApp" && yarn install --immutable \
  && yarn expo prebuild --platform android --non-interactive --no-install)
# The tag's own build script, so the reference is built the way that version was
(cd "$SRC" && bash scripts/ci-notesapp-android-build.sh)

OUT=build-output/reference
rm -rf "$OUT"
mkdir -p "$OUT"
cp "$SRC/build-output/notesapp-release.apk" "$OUT/notesapp-release.apk"
cp -R "$SRC/examples/NotesApp/maestro" "$SRC/examples/NotesApp/maestro-commands" "$OUT/"
echo "$TAG" > "$OUT/TAG"
ls -lh "$OUT"
