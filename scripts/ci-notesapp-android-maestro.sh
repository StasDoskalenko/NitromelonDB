#!/usr/bin/env bash
# android-emulator-runner invokes `sh -c` per YAML line, so this must be one
# command from the workflow (`bash scripts/ci-notesapp-android-maestro.sh <apk>`).
#
# Installs the Release APK from scripts/ci-notesapp-android-build.sh (built in its own CI job) on
# the emulator and runs the Maestro flows. The flashlight perf run is its own job too
# (scripts/ci-notesapp-android-flashlight.sh), on the same APK.
#
# Usage: bash scripts/ci-notesapp-android-maestro.sh <notesapp-release.apk>
set -euo pipefail

adb install -r "$1"

# For maestro/sync.yaml: the app reaches the sync server at 127.0.0.1:3000 through adb reverse
source "$(dirname "$0")/ci-start-sync-server.sh"
start_sync_server
adb reverse tcp:3000 tcp:3000

# Screenshots + logs of every flow step, uploaded by the workflow when a flow fails
maestro test examples/NotesApp/maestro/ --debug-output maestro-debug
