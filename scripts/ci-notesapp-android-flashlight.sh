#!/usr/bin/env bash
# android-emulator-runner invokes `sh -c` per YAML line, so this must be one
# command from the workflow (`bash scripts/ci-notesapp-android-flashlight.sh <apk> [referenceDir]`).
#
# Measures NotesApp's CPU, RAM and FPS with flashlight while maestro/pagination-dynamic.yaml runs,
# on the same Release APK the e2e job tests (scripts/ci-notesapp-android-build.sh). Writes
# perf-results/perf-result-android.json, which perf-comments.yml posts on PRs and the perf-publish
# job records on master. Informational only: a flashlight hiccup warns instead of failing the job.
#
# With a reference directory (scripts/ci-notesapp-android-reference.sh: a fixed tag's APK and
# flows), each iteration measures both apps, alternating which goes first, so they share the
# machine's slow and fast moments. The reference's results go to
# perf-results/perf-result-android-reference.json: how far they are from the reference's usual
# values is this CI machine's speed, which the comment and the charts adjust for.
#
# Usage: bash scripts/ci-notesapp-android-flashlight.sh <notesapp-release.apk> [referenceDir]
set -euo pipefail

APK=$1
REFERENCE=${2:-}
ITERATIONS=5
APP_ID=com.nitromelondb.example
FLOW=examples/NotesApp/maestro/pagination-dynamic.yaml

mkdir -p perf-results

if [ -z "$REFERENCE" ] || [ ! -f "$REFERENCE/notesapp-release.apk" ]; then
  [ -n "$REFERENCE" ] && echo "::warning::No reference build in $REFERENCE; measuring without it"
  adb install -r "$APK"
  if ! flashlight test \
    --bundleId "$APP_ID" \
    --testCommand "maestro test $FLOW" \
    --iterationCount "$ITERATIONS" \
    --duration 10000 \
    --resultsFilePath perf-results/perf-result-android.json; then
    echo "::warning::flashlight perf measurement failed (informational only)"
  fi
  exit 0
fi

PARTS=$(mktemp -d)
TAG=$(cat "$REFERENCE/TAG")

# Both apps have the same app id: uninstall first (the flows also clear the app's data)
measure() { # <apk> <flow> <resultFile>
  adb uninstall "$APP_ID" > /dev/null 2>&1 || true
  adb install "$1" > /dev/null
  if ! flashlight test \
    --bundleId "$APP_ID" \
    --testCommand "maestro test $2" \
    --iterationCount 1 \
    --duration 10000 \
    --resultsFilePath "$3"; then
    echo "::warning::flashlight iteration failed: $3 (informational only)"
  fi
}

for i in $(seq 1 "$ITERATIONS"); do
  if [ $((i % 2)) -eq 1 ]; then
    measure "$APK" "$FLOW" "$PARTS/app-$i.json"
    measure "$REFERENCE/notesapp-release.apk" "$REFERENCE/maestro/pagination-dynamic.yaml" "$PARTS/reference-$i.json"
  else
    measure "$REFERENCE/notesapp-release.apk" "$REFERENCE/maestro/pagination-dynamic.yaml" "$PARTS/reference-$i.json"
    measure "$APK" "$FLOW" "$PARTS/app-$i.json"
  fi
done

node scripts/merge-flashlight-results.mjs perf-results/perf-result-android.json "" "$PARTS"/app-*.json
node scripts/merge-flashlight-results.mjs perf-results/perf-result-android-reference.json "$TAG" "$PARTS"/reference-*.json
