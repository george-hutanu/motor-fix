// The import's live progress. On a terminal one status line is redrawn in
// place on every page read and every write step; piped or tee'd, each event
// is its own `progress` line, so `tail -f` of a log stays live and a grep for
// the run's other lines (read, plan, stopped, continue, done, incomplete,
// failed) is not flooded.
//
//   read 712/1034 · written 130/1034 · step 2/3 (set-fields) · ST-412 · lap 1 · ETA 21:40

const CLEAR = "\r\x1b[K";

/** The finishing time from the measured rates, as HH:MM local, or null before there is a rate. */
function eta({ read, total, written, started, now, writing }) {
  const elapsed = now - started;
  if (elapsed <= 0) return null;
  const left = [];
  if (read > 0 && read < total) left.push(((total - read) * elapsed) / read);
  if (writing && written > 0 && written < total) left.push(((total - written) * elapsed) / written);
  if (!left.length) return null;
  const at = new Date(now + Math.max(...left));
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/**
 * `{ log, progress }` for runImport. `write` takes raw text; `tty` picks the
 * redrawn line; `writing` is false on a dry run (no write ETA).
 */
export function reporter({ write = (t) => process.stdout.write(t), tty = Boolean(process.stdout.isTTY), now = Date.now, writing = true } = {}) {
  const started = now();
  let shown = "";
  const log = (line) => {
    if (tty && shown) write(`${CLEAR}${line}\n${shown}`);
    else write(`${line}\n`);
  };
  const progress = ({ read, total, written, lap, step, steps, kind, key }) => {
    const parts = [`read ${read}/${total}`, `written ${written}/${total}`];
    if (step) parts.push(`step ${step}/${steps} (${kind})`);
    if (key) parts.push(key);
    parts.push(`lap ${lap}`);
    const at = eta({ read, total, written, started, now: now(), writing });
    if (at) parts.push(`ETA ${at}`);
    const text = parts.join(" · ");
    if (tty) {
      shown = text;
      write(`${CLEAR}${text}`);
    } else write(`${"progress".padEnd(9)} ${text}\n`);
  };
  /** Ends the redrawn line so the shell prompt starts on its own line. */
  const end = () => {
    if (tty && shown) write("\n");
    shown = "";
  };
  return { log, progress, end };
}
