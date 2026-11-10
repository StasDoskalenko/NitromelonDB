#!/usr/bin/env bash
# android-emulator-runner invokes `sh -c` per YAML line, so this must be one
# command from the workflow (`bash scripts/ci-notesapp-android-flashlight.sh <apk>`).
#
# Measures NotesApp's CPU, RAM and FPS with flashlight while maestro/pagination-dynamic.yaml runs,
# on the same Release APK the e2e job tests (scripts/ci-notesapp-android-build.sh). Writes
# perf-results/perf-result-android.json, which perf-comments.yml posts on PRs and the perf-publish
# job records on master. Informational only: a flashlight hiccup warns instead of failing the job.
#
# Usage: bash scripts/ci-notesapp-android-flashlight.sh <notesapp-release.apk>
set -euo pipefail

adb install -r "$1"

mkdir -p perf-results
if ! flashlight test \
  --bundleId com.nitromelondb.example \
  --testCommand "maestro test examples/NotesApp/maestro/pagination-dynamic.yaml" \
  --iterationCount 5 \
  --duration 10000 \
  --resultsFilePath perf-results/perf-result-android.json; then
  echo "::warning::flashlight perf measurement failed (informational only)"
fi
