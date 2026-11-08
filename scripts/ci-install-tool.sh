#!/usr/bin/env bash
# Installs a CLI from its `curl | bash` installer (Maestro, flashlight) for a CI job, and adds it to
# the job's PATH. Retries with backoff: their installers download from GitHub release assets, which
# sometimes answer 504 for a while. Fails right away if the tool still isn't there: `curl | bash`
# reports success even when the installer's own download failed, so a job used to build for 15
# minutes and then fail on "maestro: command not found".
#
# Usage: bash scripts/ci-install-tool.sh <name> <installer URL> <path of the installed binary>
set -uo pipefail

name=$1
url=$2
bin=$3

for attempt in 1 2 3 4; do
  if curl -fsSL --retry 3 --retry-all-errors "$url" | bash && [ -x "$bin" ]; then
    echo "$(dirname "$bin")" >> "$GITHUB_PATH"
    exit 0
  fi
  echo "::warning::$name install failed (attempt $attempt of 4)"
  [ "$attempt" -lt 4 ] && sleep $((attempt * 30))
done
echo "::error::Couldn't install $name from $url"
exit 1
