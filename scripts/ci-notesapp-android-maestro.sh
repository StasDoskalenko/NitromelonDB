#!/usr/bin/env bash
# android-emulator-runner invokes `sh -c` per YAML line, so this must be one
# command from the workflow (`bash scripts/ci-notesapp-android-maestro.sh`).
#
# Same shape as native/androidTest `./gradlew connectedAndroidTest`: compile on
# the emulator job, then run. Release APK embeds JS — do not start Metro.
set -euo pipefail

examples/NotesApp/android/gradlew -p examples/NotesApp/android assembleRelease -PreactNativeArchitectures=x86

APK=$(find examples/NotesApp/android/app/build/outputs/apk -path '*release*.apk' ! -name '*unsigned*' -print -quit)
if [ -z "$APK" ]; then
  echo "NotesApp release APK not found"
  find examples/NotesApp/android/app/build/outputs/apk -type f -print || true
  exit 1
fi

adb install -r "$APK"
maestro test examples/NotesApp/maestro/

# Perf measurement reuses this same build/emulator (see .github/workflows/ci.yml)
# instead of a separate job that would rebuild the APK and boot a second
# emulator. It's informational only -- `if !` keeps a flashlight hiccup from
# failing the real e2e suite above, which is what actually gates the build.
mkdir -p perf-results
if ! flashlight test \
  --bundleId com.nitromelondb.example \
  --testCommand "maestro test examples/NotesApp/maestro/pagination-dynamic.yaml" \
  --iterationCount 5 \
  --duration 10000 \
  --resultsFilePath perf-results/perf-result-android.json; then
  echo "flashlight perf measurement failed (non-fatal, informational only)"
fi
