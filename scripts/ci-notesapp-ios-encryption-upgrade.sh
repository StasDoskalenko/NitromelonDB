#!/usr/bin/env bash
# Upgrades a NotesApp install from the plain build to the encryption build on one simulator, and
# encrypts its database in place: the path an app takes when it adds encryption to a version that
# didn't have it. Between Maestro flows (examples/NotesApp/maestro-encryption, README.md there), it
# reads the database file from the app's container to check what's really on disk:
#
#   1 plain build, fresh install, adds "Upgrade marker"   -> plain SQLite file, marker readable
#   2 encryption build over it: opens it unencrypted       -> unchanged
#   3 Encrypt button (unsafe_EncryptDB), adds a note        -> no SQLite header, marker nowhere
#   4 cold start: opens with the passphrase
#   5 plain build over it: setup fails, says why            -> file unchanged (no reset)
#   6 encryption build again: every note still there
#
# Usage: bash scripts/ci-notesapp-ios-encryption-upgrade.sh <NotesApp.app.zip> <NotesApp-encryption.app.zip>
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "Usage: $0 <NotesApp.app.zip> <NotesApp-encryption.app.zip>" >&2
  exit 2
fi
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLAIN_ZIP=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
ENCRYPTION_ZIP=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
APP_ID=com.nitromelondb.example
DB_NAME=nitromelon-example.db
MARKER="Upgrade marker"

# ci.yml boots the simulator at the start of the job (SIM_UDID). Without it, pick one and boot it.
if [ -z "${SIM_UDID:-}" ]; then
  read -r SIM_UDID SIM_NAME < <("$ROOT/scripts/pick-ios-simulator.sh")
  echo "Testing on $SIM_NAME ($SIM_UDID)"
  xcrun simctl boot "$SIM_UDID" || true
fi

unzip_app() {
  local dir
  dir=$(mktemp -d)
  ditto -x -k "$1" "$dir"
  find "$dir" -maxdepth 1 -name '*.app' -print -quit
}
PLAIN_APP=$(unzip_app "$PLAIN_ZIP")
ENCRYPTION_APP=$(unzip_app "$ENCRYPTION_ZIP")
if [ -z "$PLAIN_APP" ] || [ -z "$ENCRYPTION_APP" ]; then
  echo "No .app in $PLAIN_ZIP or $ENCRYPTION_ZIP" >&2
  exit 1
fi

# The builds are what they say: sqlite3mc's version string is compiled in only with encryption
mc_strings() {
  local executable
  executable="$1/$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$1/Info.plist")"
  strings -a "$executable" | grep -c 'SQLite3 Multiple Ciphers' || true
}
if [ "$(mc_strings "$PLAIN_APP")" != 0 ]; then
  echo "::error::The plain NotesApp build contains SQLite3 Multiple Ciphers: the default build must have no encryption" >&2
  exit 1
fi
if [ "$(mc_strings "$ENCRYPTION_APP")" = 0 ]; then
  echo "::error::The encryption NotesApp build doesn't contain SQLite3 Multiple Ciphers: NITROMELONDB_ENCRYPTION=1 didn't reach pod install" >&2
  exit 1
fi
echo "Builds: plain has no codec, encryption has SQLite3 Multiple Ciphers"

xcrun simctl bootstatus "$SIM_UDID" -b

install() {
  echo "--- Installing the $1 build"
  xcrun simctl terminate "$SIM_UDID" "$APP_ID" 2>/dev/null || true
  xcrun simctl install "$SIM_UDID" "$2"
}

db_path() {
  echo "$(xcrun simctl get_app_container "$SIM_UDID" "$APP_ID" data)/Documents/$DB_NAME"
}

# check_db plain|encrypted: the file's first 16 bytes, and whether the marker note's title can be
# read anywhere in the database files (main file, WAL, journal). The app is stopped first, so
# nothing writes meanwhile.
check_db() {
  local expected=$1 path header marker_files
  xcrun simctl terminate "$SIM_UDID" "$APP_ID" 2>/dev/null || true
  path=$(db_path)
  if [ ! -s "$path" ]; then
    echo "::error::No database at $path" >&2
    ls -la "$(dirname "$path")" >&2 || true
    exit 1
  fi
  header=$(head -c 15 "$path")
  marker_files=$(grep -l -a -F "$MARKER" "$path" "$path-wal" "$path-journal" 2>/dev/null || true)
  if [ "$expected" = plain ]; then
    if [ "$header" != "SQLite format 3" ]; then
      echo "::error::Expected a plain SQLite database, but the header is: $(head -c 16 "$path" | xxd -p)" >&2
      exit 1
    fi
    if [ -z "$marker_files" ]; then
      echo "::error::The plain database doesn't contain \"$MARKER\" (was the note saved?)" >&2
      exit 1
    fi
    echo "On disk: plain SQLite, \"$MARKER\" readable in $(basename "$marker_files" | tr '\n' ' ')"
  else
    if [ "$header" = "SQLite format 3" ]; then
      echo "::error::Expected an encrypted database, but it's plain SQLite" >&2
      exit 1
    fi
    if [ -n "$marker_files" ]; then
      echo "::error::\"$MARKER\" is readable in the encrypted database's files: $marker_files" >&2
      exit 1
    fi
    echo "On disk: no SQLite header, \"$MARKER\" not readable in any database file ($(du -h "$path" | cut -f1))"
  fi
}

db_checksum() {
  cat "$(db_path)" "$(db_path)-wal" 2>/dev/null | shasum -a 256 | cut -d' ' -f1
}

# Screenshots + logs of every flow, uploaded by the workflow when this fails
DEBUG_ROOT="${GITHUB_WORKSPACE:-$PWD}/maestro-debug"
OUTPUT_LOG="${RUNNER_TEMP:-/tmp}/maestro-encryption-output.log"
cd "$ROOT/examples/NotesApp"

# run_flow <name>: one flow from maestro-encryption/. Retried once, with a freshly installed driver,
# only if Maestro's iOS driver died (see scripts/ci-notesapp-ios-maestro.sh); every flow is safe to
# run twice.
run_flow() {
  local flow=$1 attempt extra=()
  for attempt in 1 2; do
    echo "--- Flow $flow (attempt $attempt)"
    if maestro --device "$SIM_UDID" test "maestro-encryption/$flow.yaml" ${extra[@]+"${extra[@]}"} \
      --debug-output "$DEBUG_ROOT/$flow-$attempt" 2>&1 | tee "$OUTPUT_LOG"; then
      return 0
    fi
    if [ "$attempt" = 1 ] &&
      grep -rqE 'Restarting after unexpected exit|DeviceUnreachableException|Transport unreachable|iOS driver not ready' \
        "$DEBUG_ROOT/$flow-1" "$OUTPUT_LOG" 2>/dev/null; then
      echo "::warning::Maestro's iOS driver died during $flow (mobile-dev-inc/maestro#3538); retrying it once"
      extra=(--reinstall-driver)
      continue
    fi
    return 1
  done
  return 1
}

install plain "$PLAIN_APP"
run_flow 1-plain-install
check_db plain

install encryption "$ENCRYPTION_APP"
run_flow 2-opens-unencrypted
check_db plain

run_flow 3-encrypt
check_db encrypted

run_flow 4-reopens-encrypted
check_db encrypted
before=$(db_checksum)

install plain "$PLAIN_APP"
run_flow 5-plain-refuses
check_db encrypted
if [ "$(db_checksum)" != "$before" ]; then
  echo "::error::The plain build changed the encrypted database it couldn't open" >&2
  exit 1
fi
echo "The plain build left the encrypted database untouched"

install encryption "$ENCRYPTION_APP"
run_flow 4-reopens-encrypted
check_db encrypted

echo "Upgrade to the encryption build: passed"
