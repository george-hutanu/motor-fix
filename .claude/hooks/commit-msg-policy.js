// Commit-message policy for the PreToolUse Bash hook (pre-commit-check.sh).
// Reads the hook's JSON payload on stdin. Exits 2 (block) when a `git commit`
// command violates the working agreement:
//   - one-line Conventional Commit message (no body, single -m)
//   - no metadata trailers or tool mentions (Co-Authored-By, "Generated
//     with", Claude/Anthropic, robot emoji)
// Only the message content is scanned — never the whole command — so staged
// paths like .claude/skills/... don't false-positive.
let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let cmd = "";
  try {
    cmd = JSON.parse(raw).tool_input?.command ?? "";
  } catch {
    process.exit(0);
  }
  if (!/git commit/.test(cmd)) process.exit(0);

  // A Bash call may chain several commands (git add ... && git commit ... &&
  // git commit ...). Judge each `git commit` segment on its own so a chain of
  // valid one-line commits passes while a single commit with two -m fails.
  // Message content (heredoc bodies, quoted args) can itself contain newlines
  // and separators that would confuse the split, so extract every message
  // into a placeholder first, then split the skeleton.
  const stash = [];
  const put = (body) => `@@MSG${stash.push(body) - 1}@@`;
  let scan = cmd.replace(
    /-([mF])\s+"?\$\(cat\s+<<'?([A-Za-z_]+)'?\n([\s\S]*?)\n\2[\s\S]*?\)"?/g,
    (_, flag, _tag, body) => `-${flag} ${put(body)}`
  );
  scan = scan.replace(
    /((?:^|\s)-m[= ]\s*)(?:"((?:[^"\\]|\\[\s\S])*)"|'([^']*)')/g,
    (_, prefix, dq, sq) => prefix + put(dq ?? sq ?? "")
  );

  const segments = scan.split(/&&|\|\||;|\n/).filter((s) => /git commit/.test(s));
  const mArg = /(?:^|\s)-m[= ]\s*(\S+)/g;

  let lastMessage = "";
  for (const seg of segments) {
    const messages = [];
    for (const m of seg.matchAll(mArg)) {
      messages.push(m[1].replace(/@@MSG(\d+)@@/g, (_, i) => stash[+i]));
    }
    const text = messages.join("\n");

    if (/co-authored-by|generated with|claude|anthropic|🤖/i.test(text)) {
      console.error(
        "Commit message policy: no metadata trailers or Claude/tool mentions allowed in commit messages."
      );
      process.exit(2);
    }
    if (messages.length > 1) {
      console.error(
        "Commit message policy: single -m only — the message must be one line (no body)."
      );
      process.exit(2);
    }
    if (text.split("\n").filter((l) => l.trim()).length > 1) {
      console.error("Commit message policy: the message must be one line (no body).");
      process.exit(2);
    }
    if (text.trim()) lastMessage = text.trim();
  }
  // Success: print the validated message so the calling hook can hand it to
  // downstream gates (spec-drift --staged needs the conventional-commit type).
  console.log(lastMessage);
  process.exit(0);
});
