Mode: planning — no feature is in flight.

- New feature work starts with `/speckit-specify`; it creates the branch and the
  spec. Do not create `specs/` directories by hand.
- A raw idea that is not ready for a spec goes through the assess pipeline first:
  `/speckit-assess-intake` → `-research` → `-define` → `-shape` → `-decide`.
- A bug report goes to `/speckit-bug-assess`, not through the full SDD cycle.
- Maintenance on main is unrestricted by the red-first gate, but every other gate
  (commit message, traceability, spec-drift, test+lint+typecheck) still applies.
