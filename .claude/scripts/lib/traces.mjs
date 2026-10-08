// A test file may carry one kind of requirement id (Constitution II): a
// whole-line comment such as `// @traces 006-FR-003 006-FR-004`. Nothing else
// counts: an id in a test title, in prose, after code, or on a line that also
// carries another token is not read, and none of that line's ids count.
const LINE = /^\s*\/\/ @traces((?: \d{3}-FR-\d{3})+)\s*$/gm;

/** Every requirement id on a conforming `// @traces` line, in order of appearance. */
export const traceTokens = (text) => {
  const ids = new Set();
  for (const [, list] of text.matchAll(LINE)) for (const id of list.trim().split(" ")) ids.add(id);
  return ids;
};
