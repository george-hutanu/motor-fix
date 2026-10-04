# Deferred findings: 490-notion-ready

Findings a review verified but deliberately did not act on in this feature.

- [ ] `.claude/scripts/notion-status.mjs` and 21 other harness entry points — **medium** — pre-existing: `import.meta.url === pathToFileURL(process.argv[1]).href` is false when the script is called through a symlinked path (macOS temp dirs), so the script silently does nothing and exits 0; `notion-ready.mjs` now compares real paths like `watch.mjs`. Same entry check as ST-443 (paths with spaces), so it extends that task rather than opening a new one (pr-tester lap 2, 2026-10-04) — Notion: https://app.notion.com/p/3ef607bff0d281b49468e2ce597763aa
