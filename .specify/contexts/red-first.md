Mode: red-first — the feature has open tasks and no colocated spec carries an
NNN-FR- token for it yet.

- `/speckit-tests` turns the spec's FRs into failing, traced tests. That is the
  next step; a PreToolUse gate blocks `apps/<x>/src/**` and `libs/<x>/src/**`
  edits until a spec file is added or modified, so writing implementation first
  will simply fail.
- Trace a test with a `// @traces NNN-FR-XXX` comment, not with the token in its
  title — `node .claude/scripts/trace-matrix.mjs` reads those comments, and an
  untraced test covers nothing as far as the gate knows.
- Tests are colocated: `foo.ts` gets `foo.spec.ts` beside it. A test that boots a
  real server goes in that app's `test/`, and a cross-app one in `e2e/`.
- Write the test that fails for the right reason. A test that passes before the
  feature exists is measuring nothing.
