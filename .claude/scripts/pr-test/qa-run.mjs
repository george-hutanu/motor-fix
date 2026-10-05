// The `QA run:` line of specs/<feature>/handoff.md: which PR QA run tests which
// head. Whoever dispatches a run writes it (dispatch.mjs --no-wait prints it);
// the watcher reads it to wait instead of starting an agent, and the tail
// reads it to review the finished run.
export const qaRunLine = ({ id, sha, lap, url }) => `- QA run: ${id} · head ${sha} · lap ${lap} · ${url}`;

const LINE = /^- QA run: (\d+) · head ([0-9a-f]{40}) · lap (\d+) · \S+$/gm;

/** The last `QA run:` line of a note, or null when it has none. */
export function parseQaRun(note) {
  const found = [...String(note ?? "").matchAll(LINE)].at(-1);
  return found ? { id: found[1], head: found[2], lap: Number(found[3]) } : null;
}
