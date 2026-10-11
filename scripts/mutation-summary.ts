// The Mutation workflow's summary job: reads the score.json every matrix job
// left (scripts/mutation.ts), combines a sharded project's shards, writes one
// line per project to the job summary and exits 1 when a project whose
// shards all ran is under its floor, or when any planned job left no score
// or did not succeed.
//
//   MATRIX='{"include":[…]}' RESULT=success node scripts/mutation-summary.ts <artifacts dir>

import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type Entry, plan, projectFloor } from './mutation-plan.ts';

export type Counts = {
  killed: number;
  minutes: number;
  noCoverage: number;
  survived: number;
  timeout: number;
};
export type Score = { project: string; shard: string } & (
  | Counts
  | { skipped: true }
);
export type Row = {
  complete: boolean;
  floor: number;
  minutes: number;
  project: string;
  score: number | null;
  shards: string[];
};

const ran = (score: Score): score is Score & Counts => !('skipped' in score);
const key = (project: string, shard: string) => `${project}\0${shard}`;

function combined(scores: Counts[]): number | null {
  const sum = (pick: (s: Counts) => number) =>
    scores.reduce((total, s) => total + pick(s), 0);
  const detected = sum((s) => s.killed + s.timeout);
  const valid = detected + sum((s) => s.survived + s.noCoverage);
  return valid ? Math.round((detected / valid) * 10_000) / 100 : null;
}

function row(
  project: string,
  scores: (Score & Counts)[],
  full: Entry[],
  floor: number,
): Row {
  const shards = scores.map((s) => s.shard).sort();
  const expected = full.filter((e) => e.project === project);
  return {
    complete: expected.every((e) => shards.includes(e.shard)),
    floor,
    minutes:
      Math.round(scores.reduce((total, s) => total + s.minutes, 0) * 10) / 10,
    project,
    score: combined(scores),
    shards,
  };
}

export function summarize(input: {
  floorOf: (project: string) => number;
  full: Entry[];
  planned: Entry[];
  records: Score[];
  result: string;
}): { problems: string[]; rows: Row[] } {
  const { floorOf, full, planned, records, result } = input;
  const seen = new Set(records.map((r) => key(r.project, r.shard)));
  const problems = planned
    .filter((e) => !seen.has(key(e.project, e.shard)))
    .map((e) => `${e.id}: no score; the job failed or was cut off`);
  const projects = [...new Set(planned.map((e) => e.project))].sort();
  const rows = projects.map((project) =>
    row(
      project,
      records.filter(ran).filter((r) => r.project === project),
      full,
      floorOf(project),
    ),
  );
  for (const r of rows)
    if (r.complete && r.score !== null && r.score < r.floor)
      problems.push(
        `${r.project}: ${r.score.toFixed(2)}% is under its floor of ${r.floor}`,
      );
  if (!problems.length && result !== 'success')
    problems.push(`a mutation job ended with ${result}`);
  return { problems, rows };
}

export function table(rows: Row[]): string {
  const lines = rows.map((r) => {
    const score = r.score === null ? 'n/a' : `${r.score.toFixed(2)}%`;
    const partial = r.complete ? '' : ' (partial, not held to the floor)';
    const shards = r.shards.map((s) => s || 'all').join(', ') || 'none';
    return `| ${r.project} | ${score}${partial} | ${r.floor} | ${shards} | ${r.minutes.toFixed(1)} |\n`;
  });
  return `| Project | Mutation score | Floor | Shards run | Minutes |\n|---|---|---|---|---|\n${lines.join('')}`;
}

export function readScores(dir: string): Score[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name === 'score.json')
    .map((entry) =>
      JSON.parse(readFileSync(join(entry.parentPath, entry.name), 'utf8')),
    );
}

/** The plan job's matrix; empty when the plan job failed. */
export function plannedJobs(matrix: string | undefined): Entry[] {
  const planned = JSON.parse(matrix || '{}').include;
  if (!Array.isArray(planned)) throw new Error('MATRIX holds no include list');
  return planned;
}

function main() {
  const repo = process.cwd();
  const full = plan(repo, {});
  const planned = plannedJobs(process.env['MATRIX']);
  const roots = new Map(full.map((e) => [e.project, e.root] as const));
  const floorOf = (project: string) => {
    const root = roots.get(project);
    if (!root) throw new Error(`${project} has no test:mutation target`);
    return projectFloor(join(repo, root));
  };
  const { problems, rows } = summarize({
    floorOf,
    full,
    planned,
    records: readScores(process.argv[2] ?? 'reports/mutation'),
    result: process.env['RESULT'] ?? 'success',
  });
  const text = `${table(rows)}${problems.map((p) => `\n- ${p}`).join('')}\n`;
  console.log(text);
  const summary = process.env['GITHUB_STEP_SUMMARY'];
  if (summary) appendFileSync(summary, text);
  if (problems.length) process.exitCode = 1;
}

if (process.argv[1]?.endsWith('mutation-summary.ts')) {
  try {
    main();
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
