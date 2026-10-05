# Tasks - 623-precompact-flush

- [X] T001 Red: .claude/hooks/precompact-flush.spec.mjs covers FR-001 (archived, incl. dated status, unchanged), FR-002 (draft appended), FR-003 (both porcelain columns on the first entry), clean tree.
- [X] T002 Green: precompact-flush.mjs skips an Archived spec and stops trimming the porcelain output.
- [X] T003 Bless the hook fingerprint (doctor --bless-hooks) and run npm run test:harness.
