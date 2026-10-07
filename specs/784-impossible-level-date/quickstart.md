# Quickstart: an impossible day in level_at is no waiting level in both readers

Prerequisites: `npm ci` done (vitest, `package.json`), `python3` on PATH (the
Python side of the parity specs skips without it).

## Prove the parity

```sh
npm run test:harness -- level.spec.mjs level.adversary.spec.mjs > /tmp/harness.log 2>&1; echo "exit $?"; tail -n 20 /tmp/harness.log
```

Expected: exit 0; the describe block "a level_at only one reader would accept
is no waiting level, in both readers" lists the impossible-day stamps
(`2026-02-30T00:00Z`, `2026-04-31T00:00Z`, `2025-02-29T00:00Z`,
`2026-02-31T00:00:00.000Z`, `2026-02-30T00:00+02:00`) as dropped on both
sides, the last-of-month table (`2024-02-29`, `2026-02-28`, `2026-04-30`,
`2026-01-31` in eight shapes) as kept on both sides, and scenario 3's
regressions as dropped on both sides.

Before the change, the same run fails: the JavaScript reader keeps the level
for the impossible-day stamps at a `now` one minute after the instant it
rolls them to (red first).

## Check by hand

```sh
node -e 'import("./.claude/scripts/lib/feature.mjs").then(m => console.log(m.pendingLevel({ level: 2, level_for: "next", level_at: "2026-02-30T00:00Z" }, Date.parse("2026-03-02T00:01Z"))))'
# null
cd .specify/scripts/python && python3 -c 'import common; print(common._pending_level({"level": 2, "level_for": "next", "level_at": "2026-02-30T00:00Z"}, 1772409660))'
# None
```

Then `/speckit-size` still works end to end: `node .claude/scripts/level.mjs set 1 --next`
writes a `Z` stamp with a 3-digit fraction on today's date, and `node .claude/scripts/level.mjs`
reads it back as waiting.
