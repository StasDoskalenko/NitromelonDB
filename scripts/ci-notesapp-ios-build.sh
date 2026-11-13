#!/usr/bin/env bash
# Builds NotesApp for the iOS simulator (Release, JS embedded: no Metro needed) and zips the .app
# to build-output/NotesApp.app.zip, for the jobs that test it (ci.yml uploads it as the
# notesapp-ios-app artifact; scripts/ci-notesapp-ios-maestro.sh installs it). Building in its own
# job means a flaky Maestro flow only re-runs the tests, not this ~15 minute build.
set -euo pipefail

cd examples/NotesApp

# set -o pipefail (part of -euo pipefail above) makes this fail on a real
# xcodebuild error, not just on xcbeautify's own exit code.
#
# CC/CPLUSPLUS route compilation through ccache (see scripts/ccache-clang) —
# ios/ is Expo-generated fresh every run, so there's no project file to bake
# this into the way native/iosTest's .xcodeproj does; command-line overrides
# apply it without touching the generated project.
#
# A generic simulator destination, since no simulator needs to boot here. ARCHS=arm64: the
# runners (and every simulator on them) are Apple silicon, and the generated project would
# otherwise build an x86_64 slice too, doubling the compile work.
#
# GCC_PREPROCESSOR_DEFINITIONS below is single-quoted on purpose: its
# $(DT_TOOLCHAIN_DIR)/$(inherited) are xcodebuild's own macro syntax, resolved
# by Xcode, not the shell.
# shellcheck disable=SC2016
xcodebuild \
  -workspace ios/NotesApp.xcworkspace \
  -scheme NotesApp \
  -configuration Release \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath ios/build \
  CC="$PWD/../../scripts/ccache-clang" \
  CPLUSPLUS="$PWD/../../scripts/ccache-clang++" \
  GCC_PREPROCESSOR_DEFINITIONS='CCACHE_HACK_TOOLCHAIN_DIR="$(DT_TOOLCHAIN_DIR)" $(inherited)' \
  ARCHS=arm64 \
  ONLY_ACTIVE_ARCH=NO \
  build | xcbeautify --renderer github-actions

APP_PATH=$(find ios/build/Build/Products/Release-iphonesimulator -maxdepth 1 -name '*.app' -print -quit)
if [ -z "$APP_PATH" ]; then
  echo "NotesApp.app not found"
  find ios/build/Build/Products -type d -name '*.app' || true
  exit 1
fi

# ditto keeps the bundle's symlinks and executable bits, which upload-artifact's own zip drops
mkdir -p ../../build-output
ditto -c -k --keepParent "$APP_PATH" ../../build-output/NotesApp.app.zip
ls -lh ../../build-output/NotesApp.app.zip
