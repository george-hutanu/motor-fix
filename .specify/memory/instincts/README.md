# Instincts

One file per learned behaviour, each atomic: one trigger, one action, a
confidence between 0 and 1, the evidence that created it, and the date it was
last reinforced. Adapted from ECC's continuous-learning-v2 instinct model.

- `/speckit-learn` proposes instincts from a session. **You approve them** —
  nothing writes here on its own.
- `node scripts/instincts.mjs inject` picks the few above the confidence
  threshold; the SessionStart hook prints those into a new session's context.
- `node scripts/instincts.mjs decay` fades what nothing reinforces (-0.1 per
  30 days) and retires anything under 0.3.
- `/speckit-evolve` turns a cluster of related instincts into a real skill or a
  constitution amendment, which is where a durable rule belongs.

An instinct is a habit, not a rule. Rules live in the constitution and in
CLAUDE.md, where they are enforced by gates; instincts only ever suggest.
