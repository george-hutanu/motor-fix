# Quickstart — 704-auto-phase-model-pins

Run everything from the worktree root. Prerequisites: `npm ci` done (vitest
5.0.3), `gh` as george-hutanu, `jq`.

## 1. The harness is green and the spec guards the dispatch

```bash
npm run test:harness > /tmp/harness.log 2>&1; echo "exit $?"; tail -n 20 /tmp/harness.log
node .claude/scripts/harness-eval.mjs --check; echo "exit $?"
node .claude/scripts/doctor.mjs; echo "exit $?"
```

Expected: all three exit 0; the harness log lists
`skills/speckit-auto/phase-dispatch.spec.mjs` passing. To see the spec bite,
change one dispatch line in `SKILL.md` to `model: haiku` or add a
`` `model: sonnet` `` token under `### 4. Clarify`: `npm run test:harness`
fails on that test; revert.

## 2. The pins and the owned sections are untouched

```bash
git diff origin/main -- '.claude/skills/*/SKILL.md' | grep -E '^[-+]model:' ; echo "pins changed: $?"   # expect 1 (no match)
diff <(git show origin/main:.claude/skills/speckit-auto/SKILL.md | sed -n '/^## Commit Protocol/,$p') \
     <(sed -n '/^## Commit Protocol/,$p' .claude/skills/speckit-auto/SKILL.md) && echo "hand-off, tail and command lines identical"
```

Expected: `pins changed: 1`; the `diff` prints nothing.

## 3. The trial: every dispatched phase on its pin

```bash
P=~/.claude/projects/-Users-georgehutanu-projects-motor-fix/565e5c5f-3244-431a-b602-206141d9b9d0/subagents
for m in "$P"/agent-*.meta.json; do d=$(jq -r .description "$m"); case "$d" in ST-697*) \
  echo "$d: $(jq -r 'select(.type=="assistant" and .message.model!="<synthetic>")|.message.model' "${m%.meta.json}.jsonl" | sort | uniq -c | tr '\n' ' ')";; esac; done
```

Expected: the `phase 2 specify` and `phase 5 plan` agents list only
`claude-fable-5-1`; `phase 6 checklist` and `phase 7 tasks` only
`claude-sonnet-*`; the story agent (`ST-697 phase model pins`) only
`claude-opus-*` (SC-001). The same lines are recorded in `auto-run.md`.

## 4. Before and after cost (FR-005)

```bash
P=~/.claude/projects/-Users-georgehutanu-projects-motor-fix
jq -s '[.[]|select(.type=="assistant" and .message.model!="<synthetic>")]|group_by(.message.model)
  |map({model:.[0].message.model,turns:length,input:(map(.message.usage.input_tokens)|add),
  output:(map(.message.usage.output_tokens)|add),cache_creation:(map(.message.usage.cache_creation_input_tokens)|add),
  cache_read:(map(.message.usage.cache_read_input_tokens)|add)})' <story-agent.jsonl> <its subagents…>.jsonl
```

After: session `565e5c5f-…` (story agent `agent-a7bb69b0abfa95090` and the
`ST-697*` subagents). Before: ST-673's story agent under session `2b506914-…`
(`grep -l specs/673-story-tail-agents $P/2b506914-*/subagents/agent-*.jsonl`
finds it) and its subagents. Expected in `auto-run.md`: one `before` and one
`after` row per model with those six numbers and the transcript names; the
Opus share beside the 95% baseline; "money: not measurable (no price in the
transcript; `telemetry.mjs:11` keeps none)".

## 5. A failing phase agent is not a pass

Read the `## Phases` lead-in of `SKILL.md`: a `STATUS: failure` or `blocked`
reply is the phase's failure, `partial` passes only for a Notion/mock miss
with the artifact in `FILES`, and an Agent tool error falls back inline with a
pin miss logged. The run log of this feature shows the form (each phase entry
names its model and `STATUS:` line).
