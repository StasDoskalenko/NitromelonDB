#!/usr/bin/env bash
# `yarn install --immutable` for CI, in the current directory, retried when the network fails.
#
# Yarn's fetch step crashes instead of retrying when a download times out ("The `onCancel` handler
# was attached after the promise settled"), and the whole job fails on what was a slow registry
# response: on 2026-11-14 it ended the NotesApp iOS (Maestro) job on master while installing the
# sync server. So this gives each request 3 minutes instead of Yarn's 1, and runs the install again
# with backoff when it fails. A lockfile that would change (YN0028) fails right away: that's the
# change's fault, and retrying can't fix it.
#
# Usage: bash "$GITHUB_WORKSPACE/scripts/ci-yarn-install.sh"   (with the step's working-directory)
set -uo pipefail

export YARN_HTTP_TIMEOUT="${YARN_HTTP_TIMEOUT:-180000}"

log=$(mktemp)
trap 'rm -f "$log"' EXIT

attempts=3
for attempt in $(seq 1 "$attempts"); do
  yarn install --immutable 2>&1 | tee "$log"
  status=${PIPESTATUS[0]}
  if [ "$status" -eq 0 ]; then
    exit 0
  fi
  if grep -q 'YN0028' "$log"; then
    echo "::error::yarn.lock in $PWD is out of date: run \`yarn install\` there and commit it"
    exit "$status"
  fi
  if [ "$attempt" -lt "$attempts" ]; then
    echo "::warning::yarn install in $PWD failed (attempt $attempt of $attempts), retrying"
    sleep $((attempt * 20))
  fi
done
echo "::error::yarn install in $PWD failed $attempts times"
exit "$status"
