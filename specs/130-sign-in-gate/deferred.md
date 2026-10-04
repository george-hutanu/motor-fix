# Deferred — 130-sign-in-gate

- `diff-audit` `import-extension` rule flags every extensionless relative import, though the repo uses `module: commonjs` / `moduleResolution: bundler` and never writes `.js` extensions; make it read the lib's tsconfig before flagging (`.claude/scripts/diff-audit.mjs`). (code review, LOW)
- Gate after a language save: the account language loaded at sign-in can switch the screen back before the repeated `PATCH /api/v1/me` lands; apply the saved answer's language once the repeat returns (`apps/web/src/app/auth.interceptor.ts`, language switch). (implement, follow-up)
- The sign-in address-limit integration tests share the local Redis with other worktrees and flake when they run at once; key the limits per test run (`libs/domain/src/auth/sign-in*.integration.spec.ts`). (implement, follow-up)
