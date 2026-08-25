#!/usr/bin/env bash
# android-emulator-runner runs each YAML line via `sh -c`, so this must be one
# command from the workflow (`bash scripts/ci-notesapp-android-perf.sh`).
#
# Same build as scripts/ci-notesapp-android-maestro.sh, but measures
# performance (CPU/RAM/FPS) while running the existing
# maestro/pagination-dynamic.yaml flow (write churn + scroll + pagination)
# via flashlight (https://flashlight.dev). Flashlight polls the running
# process externally over adb -- no in-app instrumentation needed.
set -euo pipefail

examples/NotesApp/android/gradlew -p examples/NotesApp/android assembleRelease -PreactNativeArchitectures=x86

APK=$(find examples/NotesApp/android/app/build/outputs/apk -path '*release*.apk' ! -name '*unsigned*' -print -quit)
if [ -z "$APK" ]; then
  echo "NotesApp release APK not found"
  find examples/NotesApp/android/app/build/outputs/apk -type f -print || true
  exit 1
fi

adb install -r "$APK"

curl -fsSL https://get.flashlight.dev | bash
export PATH="$HOME/.flashlight/bin:$PATH"

mkdir -p perf-results
flashlight test \
  --bundleId com.nitromelondb.example \
  --testCommand "maestro test examples/NotesApp/maestro/pagination-dynamic.yaml" \
  --iterationCount 5 \
  --duration 10000 \
  --resultsFilePath perf-results/perf-result-android.json
