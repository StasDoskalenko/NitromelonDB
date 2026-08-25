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

# set -o pipefail (part of -euo pipefail above) makes this fail on a real
# xcodebuild error, not just on xcbeautify's own exit code.
#
# CC/CPLUSPLUS route compilation through ccache (see scripts/ccache-clang) —
# ios/ is Expo-generated fresh every run, so there's no project file to bake
# this into the way native/iosTest's .xcodeproj does; command-line overrides
# apply it without touching the generated project.
#
# ONLY_ACTIVE_ARCH=YES: the generated project only sets this for Debug, so
# Release was building both arm64 and x86_64 simulator slices — double the
# compile work for an arch (x86_64) nothing here ever runs on.
#
# GCC_PREPROCESSOR_DEFINITIONS below is single-quoted on purpose: its
# $(DT_TOOLCHAIN_DIR)/$(inherited) are xcodebuild's own macro syntax, resolved
# by Xcode, not the shell.
# shellcheck disable=SC2016
xcodebuild \
  -workspace ios/NotesApp.xcworkspace \
  -scheme NotesApp \
  -configuration Release \
  -destination "id=$SIM_UDID" \
  -derivedDataPath ios/build \
  CC="$PWD/../../scripts/ccache-clang" \
  CPLUSPLUS="$PWD/../../scripts/ccache-clang++" \
  GCC_PREPROCESSOR_DEFINITIONS='CCACHE_HACK_TOOLCHAIN_DIR="$(DT_TOOLCHAIN_DIR)" $(inherited)' \
  ONLY_ACTIVE_ARCH=YES \
  build | xcbeautify --renderer github-actions

APP_PATH=$(find ios/build/Build/Products/Release-iphonesimulator -maxdepth 1 -name '*.app' -print -quit)
if [ -z "$APP_PATH" ]; then
  echo "NotesApp.app not found"
  find ios/build/Build/Products -type d -name '*.app' || true
  exit 1
fi

xcrun simctl install "$SIM_UDID" "$APP_PATH"
xcrun simctl launch "$SIM_UDID" com.nitromelondb.example

maestro test maestro/
