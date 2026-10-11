// Pure readers of the text the mod sees: dispatch prompts, Bash commands and
// their output, agent replies and notifications. No `$` here.

const unique = (list) => [...new Set(list)];

// "PR #363", "PR 363", "tail #363", ".../pull/363": an issue's "#1168" is not a PR.
export const prTokens = (text) =>
  unique(
    [
      ...text.matchAll(/\bPR\s*#?(\d+)\b|\btail\s+#(\d+)\b|\/pull\/(\d+)\b/gi),
    ].map((m) => Number(m[1] ?? m[2] ?? m[3])),
  );

export const worktreeTokens = (text) =>
  unique([...text.matchAll(/\.worktrees\/([\w.-]*[\w-])/g)].map((m) => m[1]));

const WATCH_FIX = /\b(resume|tail|merge-main|rerun-qa|fix-ci|merge)\b/;

// A story run, a tail or a /speckit-watch fix: the dispatches AGENTS.md gives to task-runner.
export const needsTaskRunner = (text) =>
  /\/speckit-auto\b|\btail #\d|\btail\.md\b|\bhandoff\.md\b/.test(text) ||
  (/\/speckit-watch\b/.test(text) && WATCH_FIX.test(text));

export function bashCall(command) {
  const m = command.match(
    /pr-test\/(dispatch|ci-wait)\.mjs\s+(\d+)(?:\s+--run\s+(\d+))?/,
  );
  if (!m) return undefined;
  return { kind: m[1], pr: Number(m[2]), run: m[3] ? Number(m[3]) : null };
}

export function qaRunLine(stdout) {
  const m = stdout.match(/QA run: (\d+) · head ([0-9a-f]{7,40}) · lap (\d+)/);
  return m
    ? { head: m[2].slice(0, 7), lap: Number(m[3]), qaRun: Number(m[1]) }
    : undefined;
}

export function replyBlock(text) {
  const m = text
    .replace(/\r\n/g, '\n')
    .match(/^STATUS: (.*)\nPR: (.*)\nNEXT: (.*)\nFILES: (.*)/);
  return m ? { files: m[4], next: m[3], pr: m[2], status: m[1] } : undefined;
}

// ci-wait.mjs prints one "<check>: <state>" line per check that did not pass.
export const ciLines = (stdout) =>
  stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && line !== 'PR QA: cancel')
    .map((line) => {
      const at = line.lastIndexOf(': ');
      return at < 0
        ? { name: line, state: '' }
        : { name: line.slice(0, at), state: line.slice(at + 2) };
    });

export function commandBlock(question) {
  const blocks = [...question.matchAll(/```[\w-]*\n([\s\S]*?)```/g)];
  return blocks.length === 1 ? blocks[0][1].trim() : undefined;
}

export function taskNotification(text) {
  if (!text.includes('<task-notification>')) return undefined;
  const tag = (name) =>
    text.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1];
  const code = text.match(/exit code (\d+)/);
  return {
    exitCode: code ? Number(code[1]) : null,
    id: tag('task-id'),
    status: tag('status'),
  };
}
