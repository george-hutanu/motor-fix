# Deferred — 390-audit-history

- **Test rows accumulate in activity_log** (code-reviewer, LOW). The triggers refuse TRUNCATE for every user, so Jest runs leave their entries in the local and CI databases. Nothing fails (tests key on random subject ids). Revisit when a separate migration role exists that may be allowed to clean a test database.
- **diff-audit import-extension false positive** (code-reviewer, LOW). `.claude/scripts/diff-audit.mjs` treats every `libs/` path as nodenext; the libs here resolve `bundler`/commonjs and import without `.js`. Harness fix: narrow the regex. Not edited here (gate scripts are fingerprinted).
