#!/usr/bin/env bash
# Mirrors scripts/ci-notesapp-android-maestro.sh for iOS: build a Release
# simulator build (JS embedded — do not start Metro), install it on a booted
# simulator, then run the same Maestro flows.
set -euo pipefail

cd examples/NotesApp

SIM_UDID=$(xcrun simctl list devices available --json | python3 -c "
import json, sys
data = json.load(sys.stdin)
for devices in data['devices'].values():
    for d in devices:
        if d['name'].startswith('iPhone') and d['isAvailable']:
            print(d['udid'])
            sys.exit(0)
sys.exit(1)
")
if [ -z "$SIM_UDID" ]; then
  echo "No available iPhone simulator found"
  xcrun simctl list devices available
  exit 1
fi

xcrun simctl boot "$SIM_UDID" || true
xcrun simctl bootstatus "$SIM_UDID" -b

xcodebuild \
  -workspace ios/NotesApp.xcworkspace \
  -scheme NotesApp \
  -configuration Release \
  -destination "id=$SIM_UDID" \
  -derivedDataPath ios/build \
  build

APP_PATH=$(find ios/build/Build/Products/Release-iphonesimulator -maxdepth 1 -name '*.app' -print -quit)
if [ -z "$APP_PATH" ]; then
  echo "NotesApp.app not found"
  find ios/build/Build/Products -type d -name '*.app' || true
  exit 1
fi

xcrun simctl install "$SIM_UDID" "$APP_PATH"
xcrun simctl launch "$SIM_UDID" com.nitromelondb.example

maestro test maestro/
