# Deferred — 394-role-switch

- Open question for the owner (spec-reviewer LOW, decision): when `POST /me/roles/switch` succeeds but the follow-up `GET /me` fails, the tab keeps its old role and shows the failure toast, while `last_role` already holds the new role, so the next sign-in opens the role the tab never reached. Kept as is (rare, and the next switch corrects it); a compensating switch back would be one more call that can fail too. `apps/web/src/app/dashboard/session.ts` `switchRole`.
