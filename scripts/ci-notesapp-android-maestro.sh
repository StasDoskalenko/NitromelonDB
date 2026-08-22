#!/usr/bin/env bash
# android-emulator-runner invokes `sh -c` per YAML line, so this must be one
# command from the workflow (`bash scripts/ci-notesapp-android-maestro.sh`).
#
# Release APK embeds the JS bundle — do not start Metro.
set -euo pipefail

APK=$(find examples/NotesApp/android/app/build/outputs/apk -path '*release*.apk' ! -name '*unsigned*' -print -quit)
if [ -z "$APK" ]; then
  echo "NotesApp release APK not found"
  find examples/NotesApp/android/app/build/outputs/apk -type f -print || true
  exit 1
fi

adb install -r "$APK"
maestro test examples/NotesApp/maestro/
