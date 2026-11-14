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

# Screenshots + logs of every flow step, uploaded by the workflow when a flow fails. Each attempt
# below gets its own folder, so the first attempt's diagnostics are kept when a retry follows.
#
# Two ways Maestro's XCTest driver can fail on a CI simulator, unrelated to the app:
# - Right after a first boot, the simulator can be slow enough that the driver doesn't start at all
#   (a CI run took 76 s to install the app, then the driver timed out). No flow runs.
# - Under load, an XCTest call inside the driver times out ("Failed to get screenshot: Timed out
#   while requesting screenshot"). XCTest records that as a test failure, which ends the driver's
#   HTTP server: the flow running at that moment fails, and so does every flow after it, in
#   seconds, with DeviceUnreachableException (mobile-dev-inc/maestro#3538, open; still happens
#   with Maestro 2.12.1).
# In both cases, the flows that didn't pass get one more try with a freshly installed driver. A run
# where the driver stayed up is never retried: a flow that fails on its own fails the job.
cd examples/NotesApp
DEBUG_ROOT="${GITHUB_WORKSPACE:-$PWD}/maestro-debug"
OUTPUT_LOG="${RUNNER_TEMP:-/tmp}/maestro-output.log"

# run_flows <attempt> <maestro test arguments...>
run_flows() {
  local attempt=$1
  shift
  maestro --device "$SIM_UDID" test "$@" --debug-output "$DEBUG_ROOT/attempt-$attempt" 2>&1 |
    tee "$OUTPUT_LOG"
}

# The flows of the last run that didn't pass, as maestro/<name>.yaml (all of them if none ran)
flows_to_retry() {
  local failed
  failed=$(sed -nE 's/.*\[Failed\] ([A-Za-z0-9_-]+) .*/maestro\/\1.yaml/p' "$OUTPUT_LOG")
  if grep -qE '\[(Passed|Failed)\]' "$OUTPUT_LOG"; then
    echo "$failed"
  else
    echo "maestro/"
  fi
}

# Whether the driver died during attempt <attempt>, going by its own logs
driver_died() {
  grep -rqE 'Restarting after unexpected exit|DeviceUnreachableException|Transport unreachable' \
    "$DEBUG_ROOT/attempt-$1" 2>/dev/null
}

if run_flows 1 maestro/; then
  exit 0
fi
if grep -qE '\[(Passed|Failed)\]' "$OUTPUT_LOG"; then
  if ! driver_died 1; then
    exit 1
  fi
  echo "::warning::Maestro's iOS driver died mid-run (mobile-dev-inc/maestro#3538); retrying the flows that didn't pass"
else
  echo "::warning::Maestro didn't run any flow (its driver didn't start); trying once more"
fi
RETRY=$(flows_to_retry)
if [ -z "$RETRY" ]; then
  exit 1
fi
# shellcheck disable=SC2086 # one flow file per word
run_flows 2 --reinstall-driver $RETRY
