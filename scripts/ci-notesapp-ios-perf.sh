#!/usr/bin/env bash
# Mirrors scripts/ci-notesapp-android-perf.sh for iOS: same Release build as
# scripts/ci-notesapp-ios-maestro.sh, but runs only maestro/perf-run.yaml and
# extracts its JSON summary via scripts/extract-perf-result.mjs.
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

rm -rf .maestro-perf-debug
maestro test --debug-output .maestro-perf-debug --flatten-debug-output maestro/perf-run.yaml

mkdir -p ../../perf-results
node ../../scripts/extract-perf-result.mjs .maestro-perf-debug perf-run ios ../../perf-results/perf-result-ios.json
