# Quickstart: level_at parity between the two readers

Prerequisites: `npm ci` done (vitest, `package.json`), `python3` on PATH (the
Python side of the parity specs skips without it).

## Prove the parity

```sh
npm run test:harness -- level.spec.mjs level.adversary.spec.mjs > /tmp/harness.log 2>&1; echo "exit $?"; tail -n 20 /tmp/harness.log
```

Expected: exit 0; the describe blocks "a level_at without a zone is no waiting
level, in both readers" and "keeps the pointer and the level in step in the
Python helper too" list the hour-24 stamps (`2026-10-06T24:00Z`,
`…T24:00:00Z`, `…T24:00:00.000Z`) as dropped on both sides, the scenario-3
stamps as dropped on both sides, and the accepted shapes of scenario 2 as
equal across readers.

Before the regex change, the same run fails: the JavaScript reader keeps the
level for the hour-24 stamps (red first).

## Check by hand

```sh
node -e 'import("./.claude/scripts/lib/feature.mjs").then(m => console.log(m.pendingLevel({ level: 2, level_for: "next", level_at: "2026-10-06T24:00Z" }, Date.parse("2026-10-07T00:01Z"))))'
# null
cd .specify/scripts/python && python3 -c 'import common, time; print(common._pending_level({"level": 2, "level_for": "next", "level_at": "2026-10-06T24:00Z"}, time.time()))'
# None
```

Then `/speckit-size` still works end to end: `node .claude/scripts/level.mjs set 1 --next`
writes a `Z` stamp with a 3-digit fraction, and `node .claude/scripts/level.mjs` reads it back
as waiting.
