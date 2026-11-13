#!/usr/bin/env bash
# Prints "<udid> <name>, <OS version>" of an available iPhone simulator on the newest installed iOS
# runtime, e.g. "826CC57D-… iPhone 17 Pro, iOS 26.3". Used by scripts/test-ios and the iOS CI
# scripts instead of a hardcoded device name, which broke when a runner image's simulators didn't
# match it.
#
# On a fresh GitHub macOS runner, CoreSimulator can list no devices at all for a while after boot
# (a CI run once failed with only the "Any iOS Simulator Device" placeholder available), so this
# waits up to SIM_WAIT_SECONDS (default 180) for one to show up before giving up.
#
# Usage: read -r SIM_UDID SIM_NAME < <(scripts/pick-ios-simulator.sh)
set -uo pipefail

deadline=$((SECONDS + ${SIM_WAIT_SECONDS:-180}))

pick() {
  xcrun simctl list devices available --json 2>/dev/null | python3 -c "
import json, re, sys

def version(runtime):
    # com.apple.CoreSimulator.SimRuntime.iOS-26-1 -> (26, 1)
    return tuple(int(part) for part in re.findall(r'\d+', runtime.split('.')[-1]))

devices = json.load(sys.stdin)['devices']
runtimes = sorted((r for r in devices if '.SimRuntime.iOS-' in r), key=version, reverse=True)
# A regular numbered iPhone first (the e2e flows are laid out for one), then any iPhone
for wanted in (re.compile(r'iPhone \d+'), re.compile(r'iPhone')):
    for runtime in runtimes:
        for device in devices[runtime]:
            if wanted.match(device['name']) and device['isAvailable']:
                os_name, *numbers = runtime.split('.')[-1].split('-')
                print(device['udid'], device['name'] + ', ' + os_name + ' ' + '.'.join(numbers))
                sys.exit(0)
sys.exit(1)
"
}

until pick; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "No available iPhone simulator found" >&2
    xcrun simctl list runtimes >&2
    xcrun simctl list devices available >&2
    exit 1
  fi
  echo "No iPhone simulator available yet, waiting…" >&2
  sleep 10
done
