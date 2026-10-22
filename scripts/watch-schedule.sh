#!/bin/sh
# Keep the watch running with no Claude session open: a launchd agent runs
# `watch.mjs --gate` from the main checkout every 15 minutes and, when the gate
# exits 2, `watch.mjs --dispatch`, which applies the safe fixes and starts one
# detached task-runner per plan entry, each claimed first (the claim a
# session's `--wait` and /speckit-watch share, so neither dispatches twice).
#
#   scripts/watch-schedule.sh install [--gate-only|--dispatch]  render ~/Library/LaunchAgents/com.motorfix.watch.plist and load it
#   scripts/watch-schedule.sh uninstall  unload it and remove the plist
#   scripts/watch-schedule.sh status     loaded or not, the last pass, the newest plan file
#   scripts/watch-schedule.sh run [--gate-only|--dispatch]      one pass (what launchd runs)
#
# `--gate-only` runs the gate and never dispatches: on gate exit 2 each plan
# line goes, behind its UTC time, to .work/watch-schedule/plan-<UTC date>.log
# (no plan file on exit 0 or 1). `--dispatch`, the default, is the pass above.
# Start with `install --gate-only`; after a week of plan files with
# no line a person would refuse, `uninstall`, then `install --dispatch`.
# The owner runs install; no PR or agent loads the agent.
#
# Each pass appends `<UTC time> gate <exit> [dispatch <exit>|gate-only]` to
# .work/watch-schedule/passes.log; launchd's own output goes beside it, and
# each dispatched agent's to .work/watch-dispatch/. A pass exports GH_TOKEN for
# george-hutanu (AGENTS.md "Identity"); without one it logs
# `<UTC time> no token for george-hutanu` and runs nothing. Every verb refuses
# in a cloud session.
LABEL=com.motorfix.watch

if [ "${CLAUDE_CODE_REMOTE:-}" = true ]; then
  echo "watch-schedule: refused in a cloud session (CLAUDE_CODE_REMOTE=true)" >&2
  exit 1
fi

here=$(cd "$(dirname "$0")" && pwd -P)
common=$(git -C "$here" rev-parse --path-format=absolute --git-common-dir) || exit 1
MAIN=$(dirname "$common")
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOGS="$MAIN/.work/watch-schedule"
DOMAIN="gui/$(id -u)"

usage() {
  echo "usage: watch-schedule.sh install [--gate-only|--dispatch]|uninstall|status|run [--gate-only|--dispatch]" >&2
  exit 64
}

verb=${1:-}
[ $# -gt 0 ] && shift
mode=""
for arg in "$@"; do
  case "$arg" in
    --gate-only | --dispatch) [ -n "$mode" ] && [ "$mode" != "${arg#--}" ] && usage; mode=${arg#--} ;;
    *) usage ;;
  esac
done
mode=${mode:-dispatch}

case "$verb" in
  install)
    path=""
    for tool in node claude gh; do
      found=$(command -v "$tool") || { echo "watch-schedule: $tool is not on PATH" >&2; exit 1; }
      path="$path$(dirname "$found"):"
    done
    mkdir -p "$(dirname "$PLIST")" "$LOGS"
    cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>$MAIN/scripts/watch-schedule.sh</string>
    <string>run</string>
    <string>--$mode</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$MAIN</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${path}/usr/bin:/bin</string>
  </dict>
  <key>StartInterval</key>
  <integer>900</integer>
  <key>StandardOutPath</key>
  <string>$LOGS/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>$LOGS/launchd.err.log</string>
</dict>
</plist>
PLIST
    launchctl bootout "$DOMAIN" "$PLIST" 2>/dev/null
    launchctl bootstrap "$DOMAIN" "$PLIST" || exit 1
    echo "watch-schedule: installed $PLIST (every 15 min from $MAIN, $mode)"
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null
    rm -f "$PLIST"
    echo "watch-schedule: removed $LABEL"
    ;;
  status)
    if state=$(launchctl print "$DOMAIN/$LABEL" 2>/dev/null); then
      echo "loaded: $(printf '%s\n' "$state" | grep -m1 'state =' | sed 's/^[[:space:]]*//')"
    else
      echo "not loaded"
    fi
    if [ -f "$LOGS/passes.log" ]; then echo "last pass: $(tail -n 1 "$LOGS/passes.log")"; else echo "last pass: none"; fi
    newest=$(ls "$LOGS"/plan-*.log 2>/dev/null | sort | tail -n 1)
    echo "plan files: ${newest:-none}"
    ;;
  run)
    cd "$MAIN" || exit 1
    mkdir -p "$LOGS"
    # Never fall through to gh's active account, which is the work one.
    if ! GH_TOKEN=$(gh auth token -u george-hutanu 2>/dev/null) || [ -z "$GH_TOKEN" ]; then
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) no token for george-hutanu" >> "$LOGS/passes.log"
      exit 1
    fi
    export GH_TOKEN
    if [ "$mode" = gate-only ]; then
      plan=$(node .claude/scripts/watch.mjs --gate)
      gate=$?
      now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
      [ -n "$plan" ] && printf '%s\n' "$plan"
      if [ "$gate" -eq 2 ] && [ -n "$plan" ]; then
        printf '%s\n' "$plan" | sed "s/^/$now /" >> "$LOGS/plan-${now%%T*}.log"
      fi
      echo "$now gate $gate gate-only" >> "$LOGS/passes.log"
      exit "$gate"
    fi
    node .claude/scripts/watch.mjs --gate
    gate=$?
    line="gate $gate"
    code=$gate
    if [ "$gate" -eq 2 ]; then
      node .claude/scripts/watch.mjs --dispatch
      code=$?
      line="$line dispatch $code"
    fi
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $line" >> "$LOGS/passes.log"
    exit "$code"
    ;;
  *)
    usage
    ;;
esac
