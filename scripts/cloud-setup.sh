#!/usr/bin/env bash
# Setup script for a Claude Code cloud environment (claude.ai/code): set the
# environment's setup script to `bash scripts/cloud-setup.sh` (AGENTS.md,
# "Cloud sessions"). It brings a fresh VM to a working checkout, and skips
# whatever is already done, so a second run installs nothing:
#
#   1. Node 24 (package.json engines; the VM ships 22 first on PATH, from
#      /etc/profile.d): a Node 24 already installed (CLOUD_SETUP_NODE_SEARCH,
#      by default /usr/bin, /usr/local/bin, then nvm's under /opt/nvm, ~/.nvm
#      and $NVM_DIR; the last one found wins, so nvm's newest),
#      else nvm, else n, else NodeSource's apt repository. Its directory goes
#      first on PATH, and stays first for the session: one marked line at the
#      top of ~/.bashrc (above its non-interactive return) and in
#      $CLAUDE_ENV_FILE when that is set.
#   2. npm ci, when node_modules is missing or older than package-lock.json.
#      Its `prepare` runs .husky/identity.sh apply, which in the cloud sets the
#      author only and leaves the GitHub credentials to the proxy. Then the
#      chromium revision the installed playwright-core pins, when
#      $PLAYWRIGHT_BROWSERS_PATH lacks it (the image sets
#      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD, which the install clears).
#   3. The Docker daemon up (waiting CLOUD_SETUP_DOCKER_WAIT seconds, default
#      30), then the postgres and redis images pulled for the integration tests
#      and the pre-commit hook (scripts/test-services.ts), unless both are
#      already present.
#
# It does not check CLAUDE_CODE_REMOTE (whether a cloud setup script sees it is
# unverified), and it installs system packages: never run it on the laptop.
# sudo runs with -n, so a VM that wants a password fails instead of hanging.
set -euo pipefail

NODE_MAJOR=24
cd "$(dirname "$0")/.."

log() { echo "cloud-setup: $*"; }
as_root() {
  if [ "$(id -u)" = 0 ] || ! command -v sudo >/dev/null 2>&1; then "$@"; else sudo -n "$@"; fi
}
node_major() { "${1:-node}" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
NODE_MARK="# cloud-setup: node $NODE_MAJOR"

# The last directory of the search holding a Node of the wanted major, or nothing.
installed_node() {
  local search dir found=""
  search="${CLOUD_SETUP_NODE_SEARCH:-/usr/bin /usr/local/bin /opt/nvm/versions/node/v$NODE_MAJOR*/bin $HOME/.nvm/versions/node/v$NODE_MAJOR*/bin ${NVM_DIR:-$HOME/.nvm}/versions/node/v$NODE_MAJOR*/bin}"
  for dir in $search; do
    if [ -x "$dir/node" ] && [ "$(node_major "$dir/node")" = "$NODE_MAJOR" ]; then found="$dir"; fi
  done
  echo "$found"
}

# Put the found Node first on PATH, now and in later shells of the session.
node_first() {
  local line tmp
  export PATH="$1:$PATH"
  hash -r
  line="export PATH=\"$1:\$PATH\" $NODE_MARK"
  tmp="$(mktemp)"
  { echo "$line"; [ -f "$HOME/.bashrc" ] && grep -vF "$NODE_MARK" "$HOME/.bashrc"; } >"$tmp" || true
  cat "$tmp" >"$HOME/.bashrc"
  rm -f "$tmp"
  if [ -n "${CLAUDE_ENV_FILE:-}" ]; then echo "$line" >>"$CLAUDE_ENV_FILE"; fi
}

if [ "$(node_major)" != "$NODE_MAJOR" ] && [ -n "$(installed_node)" ]; then
  node_first "$(installed_node)"
fi
if [ "$(node_major)" != "$NODE_MAJOR" ]; then
  nvm_sh="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  if [ -s "$nvm_sh" ]; then
    # nvm reads unset variables and runs failing commands, so it runs without set -eu.
    set +eu
    # shellcheck disable=SC1090
    . "$nvm_sh"
    nvm install "$NODE_MAJOR"
    nvm alias default "$NODE_MAJOR"
    set -eu
  elif command -v n >/dev/null 2>&1; then
    as_root n "$NODE_MAJOR"
  else
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | as_root bash -
    as_root apt-get install -y nodejs
  fi
  hash -r
  if [ "$(node_major)" = "$NODE_MAJOR" ]; then
    node_first "$(dirname "$(command -v node)")"
  elif [ -n "$(installed_node)" ]; then
    node_first "$(installed_node)"
  fi
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

browsers_json=node_modules/playwright-core/browsers.json
if [ -f "$browsers_json" ]; then
  revision="$(awk '/"name": *"chromium"/ { found = 1; next } found && /"revision"/ { gsub(/[^0-9]/, ""); print; exit }' "$browsers_json")"
  browsers="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
  if [ ! -d "$browsers/chromium-$revision" ] || [ ! -d "$browsers/chromium_headless_shell-$revision" ]; then
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD= npx playwright install chromium
  else
    log "chromium $revision present"
  fi
fi

if ! docker info >/dev/null 2>&1; then
  as_root service docker start >/dev/null 2>&1 || (as_root dockerd >/tmp/dockerd.log 2>&1 &)
  wait_s="${CLOUD_SETUP_DOCKER_WAIT:-30}"
  i=0
  while ! docker info >/dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -ge "$wait_s" ]; then
      echo "cloud-setup: the Docker daemon did not start (see /tmp/dockerd.log)" >&2
      exit 1
    fi
    sleep 1
  done
fi
# Docker Hub limits anonymous pulls (429 Too Many Requests), so images already
# on the VM are not pulled again; a missing one is, and a failed pull fails.
images="$(docker compose config --images postgres redis 2>/dev/null)" || images=""
# shellcheck disable=SC2086
if [ -n "$images" ] && docker image inspect $images >/dev/null 2>&1; then
  log "postgres and redis images present"
else
  docker compose pull postgres redis
fi
log "ready"
