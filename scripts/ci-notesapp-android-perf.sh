#!/usr/bin/env bash
# android-emulator-runner invokes `sh -c` per YAML line, so this must be one
# command from the workflow (`bash scripts/ci-notesapp-android-perf.sh`).
#
# Same build as scripts/ci-notesapp-android-maestro.sh, but runs only
# maestro/perf-run.yaml and extracts its JSON summary via
# scripts/extract-perf-result.mjs. See that script for why --debug-output +
# --flatten-debug-output are required (console.log from evalScript does not
# appear in plain `maestro test` stdout).
set -euo pipefail

examples/NotesApp/android/gradlew -p examples/NotesApp/android assembleRelease -PreactNativeArchitectures=x86

APK=$(find examples/NotesApp/android/app/build/outputs/apk -path '*release*.apk' ! -name '*unsigned*' -print -quit)
if [ -z "$APK" ]; then
  echo "NotesApp release APK not found"
  find examples/NotesApp/android/app/build/outputs/apk -type f -print || true
  exit 1
fi

adb install -r "$APK"

rm -rf .maestro-perf-debug
maestro test --debug-output .maestro-perf-debug --flatten-debug-output examples/NotesApp/maestro/perf-run.yaml

mkdir -p perf-results
node scripts/extract-perf-result.mjs .maestro-perf-debug perf-run android perf-results/perf-result-android.json
