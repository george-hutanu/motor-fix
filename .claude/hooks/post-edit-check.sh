#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Claude Code PostToolUse hook (matcher: Edit|Write|MultiEdit) — fast feedback
# after every edit, so concrete failures land in the agent's context now
# instead of at commit time.
#
# Ported from speckit-demo. motor-fix is a TypeScript Nx monorepo with colocated
# tests, so:
#   1. `biome check` on the edited file — the same linter `npm run lint` runs,
#      scoped to one file (fast, and honours biome.jsonc's per-path overrides)
#   2. the AFFECTED colocated test, not the suite:
#        foo.spec.ts  -> itself
#        foo.ts       -> foo.spec.ts when it exists, else nothing
#      run through the root jest config, which spans every Nx project, unless
#      Jest took 5 s or more on it in the last 7 days (spec-durations.mjs keeps
#      Jest's own time per spec); a slow spec is left to the Stop gate
#
# A tool that is not installed yet (before the Nx scaffold lands) is skipped,
# not failed: the gate exists to catch broken edits, not a missing toolchain.
#
# Typecheck is deliberately NOT here: a whole-workspace typecheck is too slow
# to run per edit. `lifecycle.mjs check` runs it with the affected unit tests
# at each slice's end and at ready, and the Stop hook re-checks what changed
# before the agent may finish.
#
# Exit 2 = feed stderr back to the model as something to fix now. Anything
# outside apps/libs/e2e source (docs, specs, hooks) passes through silently.
# ---------------------------------------------------------------------------
set -uo pipefail

payload="$(cat)"
file_path="$(node -e '
let raw="";process.stdin.on("data",d=>raw+=d).on("end",()=>{
  try{process.stdout.write(JSON.parse(raw).tool_input?.file_path??"")}catch{}
})' <<<"$payload")"

repo="${CLAUDE_PROJECT_DIR:-$(pwd)}"
rel="${file_path#"$repo"/}"

case "$rel" in
  apps/*/src/*|libs/*/src/*|apps/*/test/*|e2e/*) ;;
  *) exit 0 ;;
esac
case "$rel" in
  *.ts|*.tsx|*.mts|*.cts) ;;
  *) exit 0 ;;
esac
[ -f "$file_path" ] || exit 0   # deletions / renames have nothing to check

cd "$repo" || exit 0

if [ -x node_modules/.bin/biome ] && ! npx --no-install biome check "$rel" >&2 2>&1; then
  echo "❌ biome check failed for $rel — fix before continuing (npx biome check --write '$rel' fixes the safe ones)." >&2
  exit 2
fi

test_file=""
case "$rel" in
  *.spec.ts|*.spec.tsx|*.test.ts|*.test.tsx) test_file="$rel" ;;
  *)
    candidate="${rel%.*}.spec.${rel##*.}"
    [ -f "$candidate" ] && test_file="$candidate"
    ;;
esac
[ -n "$test_file" ] || exit 0

# A spec new on the branch whose relative import does not exist yet fails with
# "Cannot find module", which tells nobody anything: leave it unrun and say why.
red_first=".claude/scripts/lib/red-first-spec.mjs"
if [ -f "$red_first" ]; then
  spec="$(node "$red_first" "$test_file")"
  if [ $? -eq 1 ]; then
    echo "{\"hookSpecificOutput\":{\"hookEventName\":\"PostToolUse\",\"additionalContext\":\"$test_file was not run: it is red-first (new on the branch, '$spec' resolves to no file). A failure dump on a spec means its imports resolve.\"}}"
    exit 0
  fi
fi

durations=".claude/scripts/lib/spec-durations.mjs"
# Only exit 1 means "slow, skip"; a crash or a usage error still runs the spec.
should=0
[ -f "$durations" ] && { node "$durations" should "$test_file"; should=$?; }
if [ "$should" -eq 1 ]; then
  echo "{\"hookSpecificOutput\":{\"hookEventName\":\"PostToolUse\",\"additionalContext\":\"$test_file was not run after this edit: Jest took 5 s or more on it in the last 7 days. The Stop gate runs it (jest --onlyChanged) before the turn ends.\"}}"
  exit 0
fi
[ -x node_modules/.bin/jest ] || exit 0

# In a heavy-command slot with two workers, waiting at most 60 s for one; no
# slot in time skips the run and says so rather than stalling every edit.
heavy=""
[ -f scripts/heavy.sh ] && heavy="sh scripts/heavy.sh"
report="$(mktemp)"
HEAVY_WAIT="${HEAVY_WAIT:-60}" $heavy npx --no-install jest "$test_file" --maxWorkers=2 --json --outputFile="$report" >&2 2>&1
code=$?
# Jest's own time for the file, never the wait for the slot.
ms="$(node -e 'try{const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).testResults?.[0];if(r)process.stdout.write(String(r.endTime-r.startTime))}catch{}' "$report")"
[ -n "$ms" ] && [ -f "$durations" ] && node "$durations" record "$test_file" "$ms"
rm -f "$report"
if [ "$code" -eq 124 ] && [ -n "$heavy" ]; then
  echo "{\"hookSpecificOutput\":{\"hookEventName\":\"PostToolUse\",\"additionalContext\":\"Affected tests for $rel were not run: every shared heavy-command slot stayed busy for 60 s. Run $test_file before relying on it.\"}}"
  exit 0
fi
if [ "$code" -ne 0 ]; then
  echo "❌ Affected tests failed: $test_file (after editing $rel). Fix now — the Stop gate and lifecycle.mjs check will block until green." >&2
  exit 2
fi
exit 0
