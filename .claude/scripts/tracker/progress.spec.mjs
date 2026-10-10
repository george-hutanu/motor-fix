// @traces 1017-FR-012
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { reporter } from "./progress.mjs";

describe("reporter", () => {
  it("redraws one status line in place on a terminal, with an ETA from the measured rate", () => {
    const out = [];
    let t = new Date(2026, 9, 9, 20, 0).getTime();
    const r = reporter({ write: (s) => out.push(s), tty: true, now: () => t });
    t += 60_000;
    r.progress({ read: 10, total: 20, written: 5, lap: 1, step: 2, steps: 3, kind: "set-fields", key: "ST-412" });
    assert.equal(out.at(-1), "\r\x1b[Kread 10/20 · written 5/20 · step 2/3 (set-fields) · ST-412 · lap 1 · ETA 20:04");
    r.log("stopped   after ST-412");
    assert.equal(out.at(-1), "\r\x1b[Kstopped   after ST-412\nread 10/20 · written 5/20 · step 2/3 (set-fields) · ST-412 · lap 1 · ETA 20:04");
    r.end();
    assert.equal(out.at(-1), "\n");
  });

  it("prints plain lines when piped, the run's own lines unchanged", () => {
    const out = [];
    const r = reporter({ write: (s) => out.push(s), tty: false, now: () => 0 });
    r.log("done      12 items");
    r.progress({ read: 1, total: 2, written: 0, lap: 1, key: "ST-1" });
    assert.deepEqual(out, ["done      12 items\n", "progress  read 1/2 · written 0/2 · ST-1 · lap 1\n"]);
  });
});
