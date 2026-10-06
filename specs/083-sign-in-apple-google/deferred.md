# Deferred findings — 083-sign-in-apple-google

- [ ] FR-006 says a deleted account answers `provider_failed`, while the callback redirects it as `result=failed` (the redirect form every `provider_failed` outcome uses, FR-004); state the code-to-result mapping in the accounts capability so the wording and the code agree. Source: pr-tester lap 3, LOW. `libs/domain/src/auth/oauth/oauth.service.ts:357`.
