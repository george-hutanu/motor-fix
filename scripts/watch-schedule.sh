#!/bin/sh
# Keep the watch running with no Claude session open: a launchd agent runs
# `watch.mjs --gate` from the main checkout every 15 minutes and, when the gate
# exits 2, `watch.mjs --dispatch`, which applies the safe fixes and starts one
# detached task-runner per plan entry, each claimed first (the claim a
# session's `--wait` and /speckit-watch share, so neither dispatches twice).
#
#   scripts/watch-schedule.sh install    render ~/Library/LaunchAgents/com.motorfix.watch.plist and load it
#   scripts/watch-schedule.sh uninstall  unload it and remove the plist
#   scripts/watch-schedule.sh status     loaded or not, and the last pass
#   scripts/watch-schedule.sh run        one pass (what launchd runs)
#
# Each pass appends `<UTC time> gate <exit> [dispatch <exit>]` to
# .work/watch-schedule/passes.log; launchd's own output goes beside it, and
# each dispatched agent's to .work/watch-dispatch/. A pass exports GH_TOKEN for
# george-hutanu (AGENTS.md "Identity"). Every verb refuses in a cloud session.
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

case "${1:-}" in
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
    echo "watch-schedule: installed $PLIST (every 15 min from $MAIN)"
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
    ;;
  run)
    cd "$MAIN" || exit 1
    mkdir -p "$LOGS"
    GH_TOKEN=$(gh auth token -u george-hutanu 2>/dev/null) && export GH_TOKEN
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
    echo "usage: watch-schedule.sh install|uninstall|status|run" >&2
    exit 64
    ;;
esac
