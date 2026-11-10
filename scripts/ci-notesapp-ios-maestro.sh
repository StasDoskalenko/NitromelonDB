#!/usr/bin/env bash
# Mirrors scripts/ci-notesapp-android-maestro.sh for iOS: installs the simulator build from
# scripts/ci-notesapp-ios-build.sh (built in its own CI job and passed in as a zipped .app) on a
# booted simulator, then runs the Maestro flows.
#
# Usage: bash scripts/ci-notesapp-ios-maestro.sh <NotesApp.app.zip>
set -euo pipefail

APP_ZIP=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")

# Waits for a simulator to show up on a fresh runner, and picks the newest iOS runtime. Booting
# takes a minute; it happens while the sync server starts and the app unzips.
read -r SIM_UDID SIM_NAME < <("$(dirname "$0")/pick-ios-simulator.sh")
echo "Testing on $SIM_NAME ($SIM_UDID)"
xcrun simctl boot "$SIM_UDID" || true

# For maestro/sync.yaml (the simulator reaches the host's 127.0.0.1 directly)
source "$(dirname "$0")/ci-start-sync-server.sh"
start_sync_server

APP_DIR=$(mktemp -d)
ditto -x -k "$APP_ZIP" "$APP_DIR"
APP_PATH=$(find "$APP_DIR" -maxdepth 1 -name '*.app' -print -quit)
if [ -z "$APP_PATH" ]; then
  echo "No .app in $APP_ZIP"
  exit 1
fi

xcrun simctl bootstatus "$SIM_UDID" -b
xcrun simctl install "$SIM_UDID" "$APP_PATH"
xcrun simctl launch "$SIM_UDID" com.nitromelondb.example

# Screenshots + logs of every flow step, uploaded by the workflow when a flow fails
cd examples/NotesApp
maestro test maestro/ --debug-output "$GITHUB_WORKSPACE/maestro-debug"
