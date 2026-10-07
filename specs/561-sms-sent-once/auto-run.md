# Auto run — 561-sms-sent-once

Start: c769bcff (origin/main). Preflight: typecheck, lint, test green.

- confirm: gap still on main — `sendSms` marks nothing before `brevo.sendSms`; a dead worker's retry resends and recounts, and `provider_unreachable` gives the count back and retries. ST-522 covers only the failed write.
- size: level 2 (touches database: a migration)
- constitution: card read, unchanged
- specify: spec.md, 4 FRs; clarify self-answered (unconfirmed → fail `sms_unconfirmed` with fallback; count kept; no timeout/refused split)
- context: skipped org-researcher to minimise tokens; the story and finding were given in the dispatch
- open: draft PR #197, labels planning, bug, tech debt, EP-1, scope
- plan, tasks (3); checklist and analyze folded: each FR maps to T001 and T002/T003
