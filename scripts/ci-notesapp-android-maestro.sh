#!/usr/bin/env bash
# android-emulator-runner invokes `sh -c` per YAML line, so this must be one
# command from the workflow (`bash scripts/ci-notesapp-android-maestro.sh`).
set -euo pipefail

yarn --cwd examples/NotesApp start:e2e &
for i in $(seq 1 90); do
  if curl -sf http://localhost:8081/status; then
    break
  fi
  sleep 2
done
curl -sf http://localhost:8081/status

APK=$(find examples/NotesApp/android/app/build/outputs/apk/debug -name '*.apk' -print -quit)
if [ -z "$APK" ]; then
  echo "NotesApp APK not found"
  find examples/NotesApp/android/app/build/outputs/apk -type f -print || true
  exit 1
fi

adb install -r "$APK"
adb reverse tcp:8081 tcp:8081
curl -s "http://localhost:8081/index.bundle?platform=android&dev=false&minify=false" -o /tmp/notesapp.bundle || true
maestro test examples/NotesApp/maestro/
