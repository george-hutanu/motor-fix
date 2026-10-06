#!/usr/bin/env bash
# Setup script for a Claude Code cloud environment (claude.ai/code): set the
# environment's setup script to `bash scripts/cloud-setup.sh` (AGENTS.md,
# "Cloud sessions"). It brings a fresh VM to a working checkout, and skips
# whatever is already done, so a second run installs nothing:
#
#   1. Node 24 (package.json engines; the VM ships 22): nvm when installed,
#      else n, else NodeSource's apt repository.
#   2. npm ci, when node_modules is missing or older than package-lock.json.
#      Its `prepare` runs .husky/identity.sh apply, which in the cloud sets the
#      author only and leaves the GitHub credentials to the proxy.
#   3. The Docker daemon up, then the postgres and redis images pulled for the
#      integration tests and the pre-commit hook (scripts/test-services.ts).
set -euo pipefail

NODE_MAJOR=24
cd "$(dirname "$0")/.."

log() { echo "cloud-setup: $*"; }
as_root() {
  if [ "$(id -u)" = 0 ] || ! command -v sudo >/dev/null 2>&1; then "$@"; else sudo "$@"; fi
}
node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

if [ "$(node_major)" != "$NODE_MAJOR" ]; then
  nvm_sh="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  if [ -s "$nvm_sh" ]; then
    # shellcheck disable=SC1090
    . "$nvm_sh"
    nvm install "$NODE_MAJOR"
    nvm alias default "$NODE_MAJOR"
  elif command -v n >/dev/null 2>&1; then
    as_root n "$NODE_MAJOR"
  else
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | as_root bash -
    as_root apt-get install -y nodejs
  fi
  hash -r
  if [ "$(node_major)" != "$NODE_MAJOR" ]; then
    echo "cloud-setup: Node $NODE_MAJOR is not on PATH after installing it (found $(node --version 2>/dev/null || echo none))" >&2
    exit 1
  fi
fi
log "node $(node --version)"

if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm ci
else
  log "node_modules current"
fi

if ! docker info >/dev/null 2>&1; then
  as_root service docker start >/dev/null 2>&1 || (as_root dockerd >/tmp/dockerd.log 2>&1 &)
  i=0
  while ! docker info >/dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -ge 30 ]; then
      echo "cloud-setup: the Docker daemon did not start (see /tmp/dockerd.log)" >&2
      exit 1
    fi
    sleep 1
  done
fi
docker compose pull postgres redis
log "ready"
