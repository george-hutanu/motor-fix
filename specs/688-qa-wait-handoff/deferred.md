# Deferred — 688-qa-wait-handoff

- LOW (code-reviewer re-review): `.claude/scripts/pr-test/dispatch.spec.mjs` makes its fake-`gh` temp dirs under the OS tmpdir (`mkdtempSync(join(tmpdir(), 'dispatch-gh-'))`) instead of `node_modules/.cache`, the house place for test scratch; they are now removed in `afterAll`. Move the base in a later change. — Notion: https://app.notion.com/p/3f0607bff0d28141a3ebf5bb39a440ba
