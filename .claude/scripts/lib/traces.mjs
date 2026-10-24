// A test file may carry one kind of requirement id (Constitution II): a
// whole-line comment such as `// @traces 006-FR-003 006-FR-004`. Nothing else
// counts: an id in a test title, in prose, after code, or on a line that also
// carries another token is not read, and none of that line's ids count.
const LINE = /^\s*\/\/ @traces((?: \d{3,}-FR-\d{3})+)\s*$/gm;

/** Every requirement id on a conforming `// @traces` line, in order of appearance. */
export const traceTokens = (text) => {
  const ids = new Set();
  for (const [, list] of text.matchAll(LINE)) for (const id of list.trim().split(" ")) ids.add(id);
  return ids;
};

// A spec declares a requirement on its own list line: `- **FR-001**: …`
// (bold optional, `:` or `.`). An FR named in prose or in a Spec Delta is not
// a declaration. trace-matrix, status, impact and retro-evidence all count
// through this one anchor, so their totals agree.
const DECLARED = /^\s*-\s+\*{0,2}(FR-\d{3})\*{0,2}\s*[:.]/gm;

/** The FR ids a spec.md declares, deduplicated, in order of appearance. */
export const declaredFrs = (spec) => [...new Set([...(spec ?? "").matchAll(DECLARED)].map((m) => m[1]))];
