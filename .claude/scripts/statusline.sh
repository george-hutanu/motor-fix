#!/usr/bin/env bash
# Claude Code statusline for this repo: the spec-kit state the session-start
# hook prints once, kept live. Cheap on purpose — it runs on every redraw, so
# nothing here walks the tree or shells out more than it must.
#
#   ⟨010-crypto-filters-api⟩ open 0/20 · BKP-1310 · drift ok   [CAVEMAN]
#
# The caveman plugin's badge is appended when its script is present, so one
# statusLine setting serves both.
set -u
payload="$(cat)"
repo="${CLAUDE_PROJECT_DIR:-$(printf '%s' "$payload" | sed -n 's/.*"cwd":"\([^"]*\)".*/\1/p')}"
repo="${repo:-$PWD}"

feature=""
if [ -f "$repo/.specify/feature.json" ]; then
  feature="$(sed -n 's/.*"feature_directory": *"\(\.motor-fix-specs\/\)\{0,1\}specs\/\(specs\/\)\{0,1\}\([^"]*\)".*/\3/p' "$repo/.specify/feature.json")"
fi

# Either specs layout (lib/feature.mjs featuresRoot): an old clone past trunk's move holds specs/specs/<feature>.
tasks=""
tasks_file=""
for root in "$repo/specs/specs" "$repo/specs"; do
  if [ -n "$feature" ] && [ -f "$root/$feature/tasks.md" ]; then tasks_file="$root/$feature/tasks.md"; break; fi
done
if [ -n "$tasks_file" ]; then
  open="$(grep -c '^ *- \[ \]' "$tasks_file" || true)"
  total="$(grep -c '^ *- \[[ Xx]\]' "$tasks_file" || true)"
  tasks="open ${open}/${total}"
fi

branch="$(git -C "$repo" rev-parse --abbrev-ref HEAD 2>/dev/null)"
dirty="$(git -C "$repo" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"

drift=""
if [ -f "$repo/.claude/.spec-drift-state.json" ] && [ -n "$feature" ]; then
  drift="drift ok"
fi

out=""
[ -n "$feature" ] && out="⟨${feature}⟩"
[ -n "$tasks" ] && out="${out} ${tasks}"
[ -n "$branch" ] && out="${out} · ${branch}"
[ "$dirty" != "0" ] && out="${out} · ${dirty} dirty"
[ -n "$drift" ] && out="${out} · ${drift}"

caveman="$HOME/.claude/plugins/cache/caveman/caveman/0d95a81d35a9/src/hooks/caveman-statusline.sh"
if [ -x "$caveman" ]; then
  badge="$(printf '%s' "$payload" | bash "$caveman" 2>/dev/null)"
  [ -n "$badge" ] && out="${out}   ${badge}"
fi

printf '%s\n' "${out# }"
