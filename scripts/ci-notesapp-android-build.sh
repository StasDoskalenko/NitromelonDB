#!/usr/bin/env bash
# Builds NotesApp's Release APK for the x86 emulator (JS embedded: no Metro needed) and copies it to
# build-output/notesapp-release.apk, for the jobs that test it (ci.yml uploads it as the
# notesapp-android-apk artifact; the Maestro e2e and flashlight jobs install it). Building in its own
# job, without an emulator, means a flaky flow or perf run only re-runs that job.
set -euo pipefail

examples/NotesApp/android/gradlew -p examples/NotesApp/android assembleRelease -PreactNativeArchitectures=x86

APK=$(find examples/NotesApp/android/app/build/outputs/apk -path '*release*.apk' ! -name '*unsigned*' -print -quit)
if [ -z "$APK" ]; then
  echo "NotesApp release APK not found"
  find examples/NotesApp/android/app/build/outputs/apk -type f -print || true
  exit 1
fi

mkdir -p build-output
cp "$APK" build-output/notesapp-release.apk
ls -lh build-output/notesapp-release.apk
