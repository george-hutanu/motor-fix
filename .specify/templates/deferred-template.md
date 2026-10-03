# Deferred findings: <feature>

Findings a review verified but deliberately did not act on in this feature.
Borrowed from BMAD's review triage, which routes each verified finding to
**patch** (an unambiguous fix), **defer** (a real pre-existing issue that is not
this change), or **decision needed** (an ambiguous choice that requires a human,
available only when a spec exists to be ambiguous about).

Without this file the defer route does not exist, and a reviewer facing a real
pre-existing bug has two bad options: fix it, which is the scope creep the
constitution's Agent Execution Rules forbid, or drop it, which loses it.

One line per finding. `.claude/scripts/retro-evidence.mjs` reads the checkboxes, so an
item stays open until someone closes it, and `/speckit-retro` reports what is
still open.

- [ ] `path/to/file.js:120` — **medium** — pre-existing: <what is wrong and what would happen> (<reviewer>, <date>)
