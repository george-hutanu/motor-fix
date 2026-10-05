# Deferred findings — 698-tester-packet

- [ ] Measure the packet on a web PR's re-lap with failing flows. The only replay so far was PR #137, a harness-only PR, and it showed no token drop: about 249,500 weighted with the packet against 203,803 without. If a web re-lap does not drop either, cut the packet back to the parts that pay. Source: T007 measurement, MEDIUM. `.claude/scripts/pr-test/packet.mjs`, `.claude/agents/pr-tester.md` §3c–4.
