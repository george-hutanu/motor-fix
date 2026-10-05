#!/bin/sh
# Cap the memory-heavy commands every motor-fix session on this machine runs at
# once: npm ci/install, nx build/serve/test/typecheck/e2e, Jest over more than
# a few files, docker compose, Playwright, booting the apps (a --local PR
# tester run; the PR tester otherwise runs on GitHub Actions, pr-qa.yml).
#
#   scripts/heavy.sh <command...>
#
# At most HEAVY_SLOTS commands run at once, machine-wide. Each waits for a free
# slot, then for free memory, then runs with modest parallelism, and its exit
# code passes through unchanged (75 included).
#
#   HEAVY_LOCK      slot 1's lock file (default /tmp/motor-fix-heavy.lock);
#                   slot n is the same path with .n before .lock
#   HEAVY_SLOTS     how many heavy commands at once (default 4)
#   HEAVY_MIN_FREE  free-memory floor in percent (default 20)
#   HEAVY_WAIT      give up after this many seconds, exit 124, command not run
#                   (default: wait for as long as it takes)
#   HEAVY_POLL      seconds between slot checks while all are busy (default 5),
#                   and between memory checks once a slot is had (default 20)
#
# INT, TERM and HUP stop the command and free its slot, exiting 130, 143, 129.
# Dev servers (nx serve) must not run under heavy.sh: a slot held for as long
# as a server lives starves every other session.
#
# A command already holding a slot (HEAVY_HELD=1) runs a nested call at once
# rather than taking a second slot. Free memory is read with macOS
# `memory_pressure`; where it does not exist (Linux CI) the floor is not checked.
LOCK="${HEAVY_LOCK:-/tmp/motor-fix-heavy.lock}"
SLOTS="${HEAVY_SLOTS:-4}"
export NX_DAEMON=false NX_PARALLEL="${NX_PARALLEL:-2}" JEST_MAX_WORKERS="${JEST_MAX_WORKERS:-2}"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=3072}"

[ $# -gt 0 ] || { echo "usage: heavy.sh <command...>" >&2; exit 64; }
[ "${HEAVY_HELD:-}" = 1 ] && exec "$@"

deadline=""
[ -n "${HEAVY_WAIT:-}" ] && deadline=$(( $(date +%s) + HEAVY_WAIT ))
got=$(mktemp "${TMPDIR:-/tmp}/heavy-got.XXXXXX")
rm -f "$got"

# A signal stops whatever this script started — the slot holder and the
# command under it — then exits; it never falls back into the slot loop.
child=""
killtree() {
  for c in $(pgrep -P "$1" 2>/dev/null); do killtree "$c"; done
  kill -TERM "$1" 2>/dev/null
}
stop() {
  [ -n "$child" ] && { killtree "$child"; wait "$child" 2>/dev/null; }
  rm -f "$got"
  exit "$1"
}
trap 'rm -f "$got"' EXIT
trap 'stop 130' INT
trap 'stop 143' TERM
trap 'stop 129' HUP
export HEAVY_GOT="$got" HEAVY_MIN_FREE="${HEAVY_MIN_FREE:-20}" HEAVY_DEADLINE="$deadline" HEAVY_HELD=1

# Runs inside a slot: the marker says the slot was had, then the memory wait.
run='
  : > "$HEAVY_GOT"
  while :; do
    free=$(memory_pressure 2>/dev/null | awk -F": " "/free percentage/{gsub(\"%\",\"\",\$2); print \$2}")
    [ "${free:-100}" -ge "$HEAVY_MIN_FREE" ] && break
    if [ -n "$HEAVY_DEADLINE" ] && [ "$(date +%s)" -ge "$HEAVY_DEADLINE" ]; then
      echo "heavy.sh: gave up, only ${free}% memory free (floor ${HEAVY_MIN_FREE}%); not running: $*" >&2
      exit 124
    fi
    echo "heavy.sh: only ${free}% memory free, waiting ${HEAVY_POLL:-20}s" >&2
    sleep "${HEAVY_POLL:-20}"
  done
  echo "heavy.sh: running: $*" >&2
  exec "$@"'

slot() {
  l=$1
  shift
  if command -v lockf >/dev/null 2>&1; then
    /usr/bin/lockf -k -t 0 "$l" /bin/sh -c "$run" heavy "$@"
  elif command -v flock >/dev/null 2>&1; then
    flock -n -E 75 "$l" /bin/sh -c "$run" heavy "$@"
  else
    echo "heavy.sh: neither lockf nor flock here; running without a slot" >&2
    /bin/sh -c "$run" heavy "$@"
  fi
}

# In the background and waited for, so a signal is handled at once rather than
# after the command ends.
background() {
  "$@" &
  child=$!
  wait "$child"
  rc=$?
  child=""
  return "$rc"
}

waited=0
while :; do
  i=1
  while [ "$i" -le "$SLOTS" ]; do
    lock="$LOCK"
    [ "$i" -gt 1 ] && lock="${LOCK%.lock}.$i.lock"
    background slot "$lock" "$@"
    rc=$?
    # A busy slot also exits 75; the marker tells it apart from the command's own 75.
    [ -e "$got" ] && exit "$rc"
    i=$((i + 1))
  done
  if [ -n "$deadline" ] && [ "$(date +%s)" -ge "$deadline" ]; then
    echo "heavy.sh: gave up after ${HEAVY_WAIT}s, all $SLOTS slots busy (lock $LOCK); not running: $*" >&2
    exit 124
  fi
  [ "$waited" -eq 0 ] && echo "heavy.sh: all $SLOTS slots busy, waiting" >&2
  waited=1
  background sleep "${HEAVY_POLL:-5}"
done
