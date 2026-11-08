#!/usr/bin/env bash
# Records one commit's benchmark results in results/benchmarks.json on the `benchmarks` branch
# (scripts/publish-perf-results.mjs) and pushes it. Used by ci.yml (perf-publish: Android
# flashlight) and perf-ios.yml (publish: iOS sync benchmark). Both run after a merge to master and
# can finish at about the same time, so a rejected push is redone on top of the other one.
#
# Usage: scripts/ci-publish-benchmark.sh <sha> <prNumber> <androidResultFile> [iosSyncSummaryFile]
# (the arguments of scripts/publish-perf-results.mjs after the results file)
set -euo pipefail

WORKTREE=../benchmarks-branch

for attempt in 1 2 3 4 5; do
  git worktree remove --force "$WORKTREE" > /dev/null 2>&1 || true
  if git ls-remote --exit-code --heads origin benchmarks > /dev/null 2>&1; then
    git fetch origin benchmarks
    git worktree add -B benchmarks "$WORKTREE" origin/benchmarks
  else
    git worktree add --detach "$WORKTREE"
    git -C "$WORKTREE" checkout --orphan benchmarks
    git -C "$WORKTREE" rm -rf . > /dev/null 2>&1 || true
  fi

  node scripts/publish-perf-results.mjs "$WORKTREE/results/benchmarks.json" "$@"

  git -C "$WORKTREE" add results/benchmarks.json
  git -C "$WORKTREE" commit -m "chore: record perf benchmark for ${1:0:7}"
  if git -C "$WORKTREE" push origin benchmarks; then
    exit 0
  fi
  echo "Push to benchmarks was rejected (attempt $attempt); redoing it on top of the new tip"
  sleep $((attempt * 5))
done
exit 1
