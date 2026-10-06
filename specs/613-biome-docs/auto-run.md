# Auto run — 613-biome-docs

Description: ST-613 "Point the constitution and harness docs at biome.jsonc". Start: origin/main b27b5e6b.

## Size
- level 1 (set by hand): classifier said 2 on Notion "boards: 1", which is the epic's rollup; the story states the whole intent (spec Assumptions).

## Specify
- spec.md written from the story; SKILL.md:49 already clean, so four live lines remain.

## Tests
- biome-config-name.spec.mjs red (4 stale lines + no 1.8.2), then green.

## Implement
- constitution 1.8.2 PATCH + card; implement.md, spec-reviewer.md, post-edit-check.sh comment; hook re-blessed. Harness 1880 green after fix, doctor 0 failures.
