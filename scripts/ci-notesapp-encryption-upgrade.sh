#!/usr/bin/env bash
# Upgrades a NotesApp install from the plain build to the encryption build on one simulator,
# emulator or Windows machine, and encrypts its database in place: the path an app takes when it
# adds encryption to a version that didn't have it. Between UI flows (Maestro:
# examples/NotesApp/maestro-encryption, README.md there; Windows: the same flows as WinAppDriver
# tests, examples/NotesApp_windows/e2e-encryption), it copies the database files out of the app's
# data folder to check what's really on disk:
#
#   1 plain build, fresh install, adds "Upgrade marker"   -> plain SQLite file, marker readable
#   2 encryption build over it: opens it unencrypted       -> unchanged
#   3 Encrypt button (unsafe_EncryptDB), adds a note        -> no SQLite header, marker nowhere
#   4 cold start: opens with the passphrase
#   5 plain build over it: setup fails, says why            -> file unchanged (no reset)
#   6 encryption build again: every note still there
#   7 Decrypt button (unsafe_DecryptDB), adds a note        -> plain SQLite again, no copy left
#   8 plain build over it: opens it, every note there       -> plain SQLite
#
# Usage:
#   bash scripts/ci-notesapp-encryption-upgrade.sh ios <NotesApp.app.zip> <NotesApp-encryption.app.zip>
#   bash scripts/ci-notesapp-encryption-upgrade.sh android <notesapp-release.apk> <notesapp-release-encryption.apk>
#   bash scripts/ci-notesapp-encryption-upgrade.sh windows <plain AppX folder> <encryption AppX folder>
#
# iOS: a booted simulator (SIM_UDID, else this picks and boots one). Android: one running emulator
# whose image allows `adb root` (the default and google_apis images do, google_play ones don't): the
# APKs are Release builds, so `run-as` can't read the app's files. ci.yml runs the Android one
# through android-emulator-runner, which needs it to be one command. Windows (Git Bash): copies of
# each Release build's windows/NitromelonWindows.Package/bin/x64/Release/AppX, and WinAppDriver (as
# for the e2e); it removes the installed NitromelonWindows package and its data first.
set -euo pipefail

if [ $# -ne 3 ] || { [ "$1" != ios ] && [ "$1" != android ] && [ "$1" != windows ]; }; then
  echo "Usage: $0 ios|android|windows <plain build> <encryption build>" >&2
  exit 2
fi
PLATFORM=$1
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLAIN_BUILD=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
ENCRYPTION_BUILD=$(cd "$(dirname "$3")" && pwd)/$(basename "$3")
APP_ID=com.nitromelondb.example
DB_NAME=nitromelon-example.db
MARKER="Upgrade marker"
# Unzipped apps and database copies
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# unsafe_DecryptDB's plain copy (SqliteEncryption.cpp decryptedCopyPath), renamed over the database
# when it's done: one left behind after a decrypt, or next to an encrypted database, is a failure
DECRYPTED_COPY=-nitromelon-decrypted

# --- Platform: prepare, codec_strings <build>, install <label> <build>, stop_app, pull_db <dir>

if [ "$PLATFORM" = ios ]; then
  # ci.yml boots the simulator at the start of the job (SIM_UDID). Without it, pick one and boot it.
  if [ -z "${SIM_UDID:-}" ]; then
    read -r SIM_UDID SIM_NAME < <("$ROOT/scripts/pick-ios-simulator.sh")
    echo "Testing on $SIM_NAME ($SIM_UDID)"
    xcrun simctl boot "$SIM_UDID" || true
  fi
  MAESTRO_DEVICE=(--device "$SIM_UDID")
  DRIVER_DIED='Restarting after unexpected exit|DeviceUnreachableException|Transport unreachable|iOS driver not ready'

  unzip_app() {
    local dir
    dir=$(mktemp -d "$WORK/app.XXXX")
    ditto -x -k "$1" "$dir"
    find "$dir" -maxdepth 1 -name '*.app' -print -quit
  }
  PLAIN_BUILD=$(unzip_app "$PLAIN_BUILD")
  ENCRYPTION_BUILD=$(unzip_app "$ENCRYPTION_BUILD")
  if [ -z "$PLAIN_BUILD" ] || [ -z "$ENCRYPTION_BUILD" ]; then
    echo "No .app in $2 or $3" >&2
    exit 1
  fi

  prepare() {
    xcrun simctl bootstatus "$SIM_UDID" -b
  }
  codec_strings() {
    local executable
    executable="$1/$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$1/Info.plist")"
    strings -a "$executable"
  }
  install() {
    echo "--- Installing the $1 build"
    stop_app
    xcrun simctl install "$SIM_UDID" "$2"
  }
  stop_app() {
    xcrun simctl terminate "$SIM_UDID" "$APP_ID" 2>/dev/null || true
  }
  # The database, its WAL and rollback journal, and a decrypt copy, if there are any
  pull_db() {
    local path suffix
    path="$(xcrun simctl get_app_container "$SIM_UDID" "$APP_ID" data)/Documents/$DB_NAME"
    for suffix in "" -wal -journal "$DECRYPTED_COPY"; do
      if [ -f "$path$suffix" ]; then cp "$path$suffix" "$1/$DB_NAME$suffix"; fi
    done
  }
elif [ "$PLATFORM" = windows ]; then
  # The two builds share one AppX identity, so installing one over the other is: unregister the
  # package keeping its data (-PreserveApplicationData, allowed for a package registered from a
  # folder), then register the other build's folder. LocalState stays, like `adb install -r`.
  # DatabasePlatformWindows.cpp: the app's LocalFolder, no extension
  DB_NAME=nitromelon-windows
  APP_PACKAGE=NitromelonWindows

  # Windows PowerShell has the Appx module built in (PowerShell 7 needs -UseWindowsPowerShell for it)
  winps() {
    powershell.exe -NoProfile -NonInteractive -Command "$1" | tr -d '\r'
  }
  prepare() {
    # A fresh install, like the first flow's clearState on iOS/Android: no package, no data
    stop_app
    winps "Get-AppxPackage -Name $APP_PACKAGE | Remove-AppxPackage"
  }
  # No `strings` in Git Bash
  codec_strings() {
    tr -c '[:print:]' '\n' <"$1/NitromelonWindows/NitromelonDB.dll"
  }
  install() {
    echo "--- Installing the $1 build"
    stop_app
    winps "\$p = Get-AppxPackage -Name $APP_PACKAGE
      if (\$p) { Remove-AppxPackage -Package \$p.PackageFullName -PreserveApplicationData }
      Add-AppxPackage -Register '$(cygpath -w "$2")\\AppxManifest.xml'"
  }
  stop_app() {
    taskkill //IM NitromelonWindows.exe //F >/dev/null 2>&1 || true
    # Until the process has let go of the database files
    sleep 2
  }
  pull_db() {
    local dir suffix
    dir="$(cygpath -u "$LOCALAPPDATA")/Packages/$(winps "(Get-AppxPackage -Name $APP_PACKAGE).PackageFamilyName")/LocalState"
    for suffix in "" -wal -journal "$DECRYPTED_COPY"; do
      if [ -f "$dir/$DB_NAME$suffix" ]; then cp "$dir/$DB_NAME$suffix" "$1/$DB_NAME$suffix"; fi
    done
  }
else
  # NativeDatabasePath.java: getDatabasePath() without its /databases
  DEVICE_DB="/data/data/$APP_ID/$DB_NAME"
  MAESTRO_DEVICE=()
  DRIVER_DIED='DeviceUnreachableException|Transport unreachable|UNAVAILABLE: io exception'

  prepare() {
    adb wait-for-device
    adb root >/dev/null
    adb wait-for-device
    if [ "$(adb shell id -u | tr -d '\r')" != 0 ]; then
      echo "::error::adb root didn't work on this emulator image (google_play images refuse it); this script reads the app's database as root" >&2
      exit 1
    fi
  }
  # Release APKs keep libNitromelonDB.so (which has SQLite in it) uncompressed or deflated: unzip
  # reads both
  codec_strings() {
    unzip -p "$1" 'lib/*/libNitromelonDB.so' | strings -a
  }
  install() {
    echo "--- Installing the $1 build"
    stop_app
    # -r keeps the app's data, like an update from the store. Both builds are signed with the
    # Expo template's debug keystore.
    adb install -r "$2"
  }
  stop_app() {
    adb shell am force-stop "$APP_ID"
  }
  pull_db() {
    local suffix
    for suffix in "" -wal -journal "$DECRYPTED_COPY"; do
      if adb shell "test -f '$DEVICE_DB$suffix'"; then
        adb exec-out cat "$DEVICE_DB$suffix" >"$1/$DB_NAME$suffix"
      fi
    done
  }
fi

# --- The builds are what they say: sqlite3mc's version string is compiled in only with encryption

codec_count() {
  codec_strings "$1" | grep -c 'SQLite3 Multiple Ciphers' || true
}
if [ "$(codec_count "$PLAIN_BUILD")" != 0 ]; then
  echo "::error::The plain NotesApp build contains SQLite3 Multiple Ciphers: the default build must have no encryption" >&2
  exit 1
fi
if [ "$(codec_count "$ENCRYPTION_BUILD")" = 0 ]; then
  echo "::error::The encryption NotesApp build doesn't contain SQLite3 Multiple Ciphers: NITROMELONDB_ENCRYPTION=1 didn't reach the native build" >&2
  exit 1
fi
echo "Builds: plain has no codec, encryption has SQLite3 Multiple Ciphers"

prepare

# check_db plain|encrypted: the file's first 16 bytes, and whether the marker note's title can be
# read anywhere in the database files (main file, WAL, journal). The app is stopped first, so
# nothing writes meanwhile. Leaves the copies in $WORK/db for db_checksum.
check_db() {
  local expected=$1 dir="$WORK/db" path header marker_files
  stop_app
  rm -rf "$dir" && mkdir -p "$dir"
  pull_db "$dir"
  path="$dir/$DB_NAME"
  if [ ! -s "$path" ]; then
    echo "::error::No database in the app's data folder" >&2
    exit 1
  fi
  header=$(head -c 15 "$path")
  if [ -f "$dir/$DB_NAME$DECRYPTED_COPY" ]; then
    echo "::error::$DB_NAME$DECRYPTED_COPY (unsafe_DecryptDB's copy) was left in the app's data folder" >&2
    exit 1
  fi
  marker_files=$(grep -l -a -F "$MARKER" "$dir"/* 2>/dev/null || true)
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
      echo "::error::\"$MARKER\" is readable in the encrypted database's files: $(basename "$marker_files" | tr '\n' ' ')" >&2
      exit 1
    fi
    echo "On disk: no SQLite header, \"$MARKER\" not readable in any database file ($(du -h "$path" | cut -f1))"
  fi
}

# Of the copies check_db just pulled. The WAL only if there is one (on Windows there may be none),
# since under pipefail a missing file would end the script without a word.
db_checksum() {
  local files=("$WORK/db/$DB_NAME")
  if [ -f "$WORK/db/$DB_NAME-wal" ]; then files+=("$WORK/db/$DB_NAME-wal"); fi
  # sha256sum on Linux and in Git Bash (whose PATH on the runner has no shasum), shasum on macOS
  if command -v sha256sum >/dev/null; then
    cat "${files[@]}" | sha256sum | cut -d' ' -f1
  else
    cat "${files[@]}" | shasum -a 256 | cut -d' ' -f1
  fi
}

if [ "$PLATFORM" = windows ]; then
  cd "$ROOT/examples/NotesApp_windows"
  # run_flow <name>: one test from e2e-encryption/. On failure, e2e/environment.js saves a
  # screenshot and the UI tree to .tmp/diagnostics, uploaded by the workflow.
  run_flow() {
    echo "--- Flow $1"
    yarn jest --config jest.e2e-encryption.config.js --forceExit "e2e-encryption/$1.test.js"
  }
else
# Screenshots + logs of every flow, uploaded by the workflow when this fails
DEBUG_ROOT="${GITHUB_WORKSPACE:-$PWD}/maestro-debug"
OUTPUT_LOG="$WORK/maestro-output.log"
cd "$ROOT/examples/NotesApp"

# run_flow <name>: one flow from maestro-encryption/. Retried once, with a freshly installed driver,
# only if Maestro's driver died (on iOS: scripts/ci-notesapp-ios-maestro.sh); every flow is safe to
# run twice.
run_flow() {
  local flow=$1 attempt extra=()
  for attempt in 1 2; do
    echo "--- Flow $flow (attempt $attempt)"
    if maestro ${MAESTRO_DEVICE[@]+"${MAESTRO_DEVICE[@]}"} test "maestro-encryption/$flow.yaml" \
      ${extra[@]+"${extra[@]}"} --debug-output "$DEBUG_ROOT/$flow-$attempt" 2>&1 | tee "$OUTPUT_LOG"; then
      return 0
    fi
    if [ "$attempt" = 1 ] && grep -rqE "$DRIVER_DIED" "$DEBUG_ROOT/$flow-1" "$OUTPUT_LOG" 2>/dev/null; then
      echo "::warning::Maestro's driver died during $flow; retrying it once"
      extra=(--reinstall-driver)
      continue
    fi
    return 1
  done
  return 1
}
fi

install plain "$PLAIN_BUILD"
run_flow 1-plain-install
check_db plain

install encryption "$ENCRYPTION_BUILD"
run_flow 2-opens-unencrypted
check_db plain

run_flow 3-encrypt
check_db encrypted

run_flow 4-reopens-encrypted
check_db encrypted
before=$(db_checksum)

install plain "$PLAIN_BUILD"
run_flow 5-plain-refuses
check_db encrypted
if [ "$(db_checksum)" != "$before" ]; then
  echo "::error::The plain build changed the encrypted database it couldn't open" >&2
  exit 1
fi
echo "The plain build left the encrypted database untouched"

install encryption "$ENCRYPTION_BUILD"
run_flow 4-reopens-encrypted
check_db encrypted

run_flow 7-decrypt
check_db plain

install plain "$PLAIN_BUILD"
run_flow 8-plain-opens-decrypted
check_db plain

echo "Upgrade to the encryption build ($PLATFORM): passed"
