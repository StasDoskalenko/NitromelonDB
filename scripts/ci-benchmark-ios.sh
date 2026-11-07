#!/usr/bin/env bash
# Run by .github/workflows/perf-ios.yml. Builds Release simulator builds of both benchmark apps
# (examples/benchmark: NitromelonDB from this checkout, WatermelonDB 0.28 with JSI as the
# baseline), then drives their Sync, Realistic sync and Stress cards with the same scripted runner
# the benchmark README describes, interleaving the two apps run by run. CI machines vary a lot from
# run to run, so the number to watch is NitromelonDB relative to WatermelonDB measured in the same
# job; the absolute times only compare within one run.
#
# Expects both apps to be prebuilt with pods installed (the workflow does it, so it can cache
# Pods). Writes the runner's JSONL to perf-results/ios/ and the summary to
# perf-results/perf-result-ios-sync.json (scripts/ios-sync-summary.mjs).
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
BENCH="$REPO_ROOT/examples/benchmark"
OUT="$REPO_ROOT/perf-results/ios"
mkdir -p "$OUT"

SYNC_RUNS=${SYNC_RUNS:-5}
REAL_RUNS=${REAL_RUNS:-5}
STRESS_RUNS=${STRESS_RUNS:-3}

# Realistic sync pulls from the mock server (the simulator reaches the host's localhost directly)
node "$BENCH/mock-server/server.mjs" > "${RUNNER_TEMP:-/tmp}/mock-server.log" 2>&1 &
MOCK_PID=$!
trap 'kill "$MOCK_PID" 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do
  curl -sf http://127.0.0.1:8787/health > /dev/null && break
  sleep 0.2
done
curl -sf http://127.0.0.1:8787/health > /dev/null || { cat "${RUNNER_TEMP:-/tmp}/mock-server.log"; exit 1; }

# Same pick as scripts/ci-notesapp-ios-maestro.sh, plus the name and runtime for the summary
SIM_LINE=$(xcrun simctl list devices available --json | python3 -c "
import json, sys
data = json.load(sys.stdin)
for runtime, devices in data['devices'].items():
    for d in devices:
        if d['name'].startswith('iPhone') and d['isAvailable']:
            os_name, *version = runtime.split('.')[-1].split('-')  # ...SimRuntime.iOS-26-1
            print(d['udid'], d['name'] + ', ' + os_name + ' ' + '.'.join(version))
            sys.exit(0)
sys.exit(1)
") || true
SIM_UDID=${SIM_LINE%% *}
SIM_NAME=${SIM_LINE#* }
if [ -z "$SIM_UDID" ]; then
  echo "No available iPhone simulator found"
  xcrun simctl list devices available
  exit 1
fi
xcrun simctl boot "$SIM_UDID" || true
xcrun simctl bootstatus "$SIM_UDID" -b

# See scripts/ci-notesapp-ios-maestro.sh for the ccache and ONLY_ACTIVE_ARCH overrides.
build_and_install() {
  local app_dir=$1 workspace scheme app_path
  workspace=$(find "$app_dir/ios" -maxdepth 1 -name '*.xcworkspace' -print -quit)
  scheme=$(basename "$workspace" .xcworkspace)
  # shellcheck disable=SC2016
  xcodebuild \
    -workspace "$workspace" \
    -scheme "$scheme" \
    -configuration Release \
    -destination "id=$SIM_UDID" \
    -derivedDataPath "$app_dir/ios/build" \
    CC="$REPO_ROOT/scripts/ccache-clang" \
    CPLUSPLUS="$REPO_ROOT/scripts/ccache-clang++" \
    GCC_PREPROCESSOR_DEFINITIONS='CCACHE_HACK_TOOLCHAIN_DIR="$(DT_TOOLCHAIN_DIR)" $(inherited)' \
    ONLY_ACTIVE_ARCH=YES \
    build | xcbeautify --renderer github-actions
  app_path=$(find "$app_dir/ios/build/Build/Products/Release-iphonesimulator" -maxdepth 1 -name '*.app' -print -quit)
  if [ -z "$app_path" ]; then
    echo "No .app built in $app_dir"
    exit 1
  fi
  xcrun simctl install "$SIM_UDID" "$app_path"
}

build_and_install "$BENCH/nitromelondb_benchmark"
build_and_install "$BENCH/watermelondb_benchmark"

# The baseline has to be WatermelonDB's JSI adapter: without its native module it silently falls
# back to the asynchronous bridge adapter, which is ~2x slower and would flatter every ratio.
cat > "${RUNNER_TEMP:-/tmp}/check-wm-engine.yaml" <<'EOF'
appId: com.watermelondb.benchmark
---
- launchApp:
    stopApp: true
- tapOn:
    text: "Cancel"
    optional: true
- extendedWaitUntil:
    visible: ".*WatermelonDB SQLite \\(JSI\\).*"
    timeout: 30000
EOF
maestro --device "$SIM_UDID" test "${RUNNER_TEMP:-/tmp}/check-wm-engine.yaml"

APPS='NitromelonDB=com.nitromelondb.benchmark;WatermelonDB JSI=com.watermelondb.benchmark'
run_card() {
  local card=$1 sizes=$2 runs=$3
  echo "::group::$card ($sizes, $runs runs per app)"
  node "$BENCH/scripts/run-sync-trials.mjs" --card "$card" --apps "$APPS" --sizes "$sizes" \
    --runs "$runs" --device "$SIM_UDID" --out "$OUT/$card.jsonl"
  echo "::endgroup::"
}
run_card sync 5000,50000 "$SYNC_RUNS"
run_card real 300 "$REAL_RUNS"
run_card stress 100000 "$STRESS_RUNS"

node "$REPO_ROOT/scripts/ios-sync-summary.mjs" "$OUT" "$REPO_ROOT/perf-results/perf-result-ios-sync.json" \
  --device "$SIM_NAME"
