#!/usr/bin/env bash
# Sourced by the NotesApp Maestro CI scripts. Starts the reference sync server (examples/sync-server)
# with the NotesApp schema on port 3000 for maestro/sync.yaml, and stops it when the script exits.
# Needs `yarn install` in examples/sync-server first (the workflow does it).

start_sync_server() {
  local repo_root log
  repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
  log="${RUNNER_TEMP:-/tmp}/sync-server.log"

  # exec, so that $! is the node process itself and the trap below really stops it
  (
    cd "$repo_root/examples/sync-server" &&
      SYNC_SERVER_SCHEMA=notes-app SYNC_SERVER_TEST_HOOKS=1 DATABASE=:memory: PORT=3000 exec node src/main.ts
  ) >"$log" 2>&1 &
  SYNC_SERVER_PID=$!
  trap 'kill "$SYNC_SERVER_PID" 2>/dev/null || true' EXIT

  for _ in $(seq 1 50); do
    if curl -sf http://127.0.0.1:3000/health >/dev/null; then
      echo "Sync server is up (pid $SYNC_SERVER_PID)"
      return 0
    fi
    sleep 0.2
  done
  echo "Sync server didn't start:"
  cat "$log"
  return 1
}
