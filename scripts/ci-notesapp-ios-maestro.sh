#!/usr/bin/env bash
# Mirrors scripts/ci-notesapp-android-maestro.sh for iOS: installs the simulator build from
# scripts/ci-notesapp-ios-build.sh (built in its own CI job and passed in as a zipped .app) on a
# booted simulator, then runs the Maestro flows.
#
# Usage: bash scripts/ci-notesapp-ios-maestro.sh <NotesApp.app.zip>
set -euo pipefail

APP_ZIP=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")

# For maestro/sync.yaml (the simulator reaches the host's 127.0.0.1 directly). It waits up to 60 s
# for the server, which a booting simulator can slow down.
source "$(dirname "$0")/ci-start-sync-server.sh"
start_sync_server

# ci.yml boots the simulator at the start of the job (SIM_UDID), so it finishes its first-boot work
# while the job sets up. Without it, this picks one (newest iOS runtime) and boots it now.
if [ -z "${SIM_UDID:-}" ]; then
  read -r SIM_UDID SIM_NAME < <("$(dirname "$0")/pick-ios-simulator.sh")
  echo "Testing on $SIM_NAME ($SIM_UDID)"
  xcrun simctl boot "$SIM_UDID" || true
fi

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

# Screenshots + logs of every flow step, uploaded by the workflow when a flow fails.
#
# Right after a first boot, the simulator can be slow enough that Maestro's XCTest driver doesn't
# start at all (a CI run took 76 s to install the app, then the driver timed out). If no flow ran,
# that's what happened, so it gets one more try; a flow that ran and failed is never retried.
cd examples/NotesApp
run_flows() {
  maestro --device "$SIM_UDID" test maestro/ --debug-output "$GITHUB_WORKSPACE/maestro-debug" 2>&1 |
    tee "${RUNNER_TEMP:-/tmp}/maestro-output.log"
}
if ! run_flows; then
  if grep -qE '\[(Passed|Failed)\]' "${RUNNER_TEMP:-/tmp}/maestro-output.log"; then
    exit 1
  fi
  echo "::warning::Maestro didn't run any flow (its driver didn't start); trying once more"
  run_flows
fi
