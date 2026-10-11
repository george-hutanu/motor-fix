import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type Entry, plan } from './mutation-plan.ts';
import {
  plannedJobs,
  readScores,
  summarize,
  table,
} from './mutation-summary.ts';

const realRepo = join(__dirname, '..');
const summaryScript = join(__dirname, 'mutation-summary.ts');

const entry = (project: string, shard = ''): Entry => ({
  id: shard ? `${project}-${shard}` : project,
  project,
  root: `libs/${project}`,
  shard,
  timeout: 60,
});

const record = (
  project: string,
  shard: string,
  killed: number,
  survived: number,
  extra: Partial<{ timeout: number; noCoverage: number; minutes: number }> = {},
) => ({
  floor: 0,
  killed,
  minutes: extra.minutes ?? 10,
  noCoverage: extra.noCoverage ?? 0,
  project,
  score: null,
  shard,
  survived,
  timeout: extra.timeout ?? 0,
});

const one = (floor: number, killed: number, survived: number, extra = {}) =>
  summarize({
    floorOf: () => floor,
    full: [entry('p')],
    planned: [entry('p')],
    records: [record('p', '', killed, survived, extra)],
    result: 'success',
  });

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mutation-sum-adv-'));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe('combined score arithmetic', () => {
  it('rounds half up to two decimals exactly, for every killed/valid pair up to 300 mutants', () => {
    const wrong: string[] = [];
    for (let valid = 1; valid <= 300; valid++)
      for (let killed = 0; killed <= valid; killed++) {
        const exact = Math.floor((killed * 20_000 + valid) / (2 * valid)) / 100;
        const got = one(0, killed, valid - killed).rows[0]?.score;
        if (got !== exact) wrong.push(`${killed}/${valid}: ${got} != ${exact}`);
      }
    expect(wrong.slice(0, 5)).toEqual([]);
  });

  it('sums mutants over shards instead of averaging shard percentages', () => {
    const { rows } = summarize({
      floorOf: () => 0,
      full: [entry('p', 'a'), entry('p', 'b')],
      planned: [entry('p', 'a'), entry('p', 'b')],
      records: [record('p', 'a', 1, 0), record('p', 'b', 0, 99)],
      result: 'success',
    });

    expect(rows[0]?.score).toBe(1);
  });

  it('counts a timed-out mutant as detected and an uncovered one as undetected', () => {
    expect(one(0, 0, 0, { noCoverage: 1, timeout: 1 }).rows[0]?.score).toBe(50);
  });

  it('passes a score exactly at the floor and fails one hundredth under', () => {
    expect(one(95, 19, 1).problems).toEqual([]);
    expect(one(95, 9499, 501).problems).toEqual([
      'p: 94.99% is under its floor of 95',
    ]);
  });

  it('reports 100 for a project with no survivor', () => {
    expect(one(100, 7, 0).rows[0]?.score).toBe(100);
    expect(one(100, 7, 0).problems).toEqual([]);
  });

  it('reports n/a and applies no floor to a project with no valid mutant', () => {
    const { problems, rows } = one(100, 0, 0);

    expect(rows[0]?.score).toBeNull();
    expect(problems).toEqual([]);
    expect(table(rows)).toContain('n/a');
  });

  it('does not let a shard with no mutants hide another shard under the floor', () => {
    const { problems } = summarize({
      floorOf: () => 90,
      full: [entry('p', 'a'), entry('p', 'b')],
      planned: [entry('p', 'a'), entry('p', 'b')],
      records: [record('p', 'a', 0, 0), record('p', 'b', 1, 1)],
      result: 'success',
    });

    expect(problems).toEqual(['p: 50.00% is under its floor of 90']);
  });

  it('survives counts in the millions', () => {
    expect(one(0, 7_000_000, 3_000_000).rows[0]?.score).toBe(70);
  });
});

describe('partial and complete projects', () => {
  const domain = [entry('domain', 'a'), entry('domain', 'rest')];

  it('is complete when the plan was narrowed to the project and still ran every shard of the full plan', () => {
    const { problems } = summarize({
      floorOf: () => 90,
      full: domain,
      planned: domain,
      records: [record('domain', 'a', 0, 5), record('domain', 'rest', 0, 5)],
      result: 'success',
    });

    expect(problems).toEqual(['domain: 0.00% is under its floor of 90']);
  });

  it('is partial when only rest ran, however low the score', () => {
    const { problems, rows } = summarize({
      floorOf: () => 90,
      full: domain,
      planned: [entry('domain', 'rest')],
      records: [record('domain', 'rest', 0, 5)],
      result: 'success',
    });

    expect(problems).toEqual([]);
    expect(rows[0]?.complete).toBe(false);
    expect(table(rows)).toMatch(/partial/);
  });

  it('is partial when a shard job failed, and names the job and not the floor', () => {
    const { problems } = summarize({
      floorOf: () => 90,
      full: domain,
      planned: domain,
      records: [record('domain', 'a', 0, 5)],
      result: 'failure',
    });

    expect(problems).toEqual([
      'domain-rest: no score; the job failed or was cut off',
    ]);
  });

  it('counts a skipped record as a job that ran but holds no score', () => {
    const { problems, rows } = summarize({
      floorOf: () => 90,
      full: [entry('worker')],
      planned: [entry('worker')],
      records: [{ project: 'worker', shard: '', skipped: true }],
      result: 'success',
    });

    expect(problems).toEqual([]);
    expect(rows[0]?.score).toBeNull();
  });

  it('lists both a missing job and an under-floor project when both hold', () => {
    const { problems } = summarize({
      floorOf: () => 90,
      full: [entry('p'), entry('q')],
      planned: [entry('p'), entry('q')],
      records: [record('p', '', 1, 9)],
      result: 'failure',
    });

    expect(problems).toEqual([
      'q: no score; the job failed or was cut off',
      'p: 10.00% is under its floor of 90',
    ]);
  });

  it('fails on a result of cancelled, skipped or timed_out even when every score is present', () => {
    for (const result of ['cancelled', 'skipped', 'failure']) {
      const { problems } = summarize({
        floorOf: () => 0,
        full: [entry('p')],
        planned: [entry('p')],
        records: [record('p', '', 5, 0)],
        result,
      });
      expect(problems).toEqual([`a mutation job ended with ${result}`]);
    }
  });

  it('fails when nothing was planned and the result is not success', () => {
    const { problems } = summarize({
      floorOf: () => 0,
      full: [entry('p')],
      planned: [],
      records: [],
      result: 'skipped',
    });

    expect(problems).toEqual(['a mutation job ended with skipped']);
  });

  it('counts a shard score once when the same job is downloaded twice', () => {
    const { rows } = summarize({
      floorOf: () => 0,
      full: [entry('p')],
      planned: [entry('p')],
      records: [
        record('p', '', 9, 1, { minutes: 10 }),
        record('p', '', 9, 1, { minutes: 10 }),
      ],
      result: 'success',
    });

    expect(rows[0]?.shards).toEqual(['']);
    expect(rows[0]?.minutes).toBe(10);
  });

  it('refuses a score file with no counts instead of passing it as NaN', () => {
    const { problems } = summarize({
      floorOf: () => 90,
      full: [entry('p')],
      planned: [entry('p')],
      records: [{ project: 'p', shard: '' } as never],
      result: 'success',
    });

    expect(problems).not.toEqual([]);
  });
});

describe('readScores', () => {
  const put = (path: string, content: unknown) => {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), JSON.stringify(content));
  };

  it('returns nothing for a missing directory and for an empty one', () => {
    expect(readScores(join(dir, 'nope'))).toEqual([]);
    expect(readScores(dir)).toEqual([]);
  });

  it('finds score.json at any depth and ignores other files', () => {
    put('mutation-a/p/score.json', record('p', '', 1, 0));
    put('mutation-b/p/s/score.json', record('p', 's', 1, 0));
    put('mutation-b/p/s/mutation.json', { files: {} });
    put('score.json.bak', {});

    expect(
      readScores(dir)
        .map((s) => s.shard)
        .sort(),
    ).toEqual(['', 's']);
  });

  it('names the file when a score.json is not JSON', () => {
    mkdirSync(join(dir, 'mutation-a'), { recursive: true });
    writeFileSync(join(dir, 'mutation-a', 'score.json'), '{ half');

    expect(() => readScores(dir)).toThrow(/mutation-a/);
  });
});

describe('plannedJobs', () => {
  it('returns the include list', () => {
    expect(plannedJobs(JSON.stringify({ include: [entry('p')] }))).toEqual([
      entry('p'),
    ]);
  });

  // A failed plan job must fail the summary, not pass it with nothing planned.
  it.each([undefined, '', '{}'])(
    'refuses a matrix of %p, left when the plan job failed',
    (matrix) => {
      expect(() => plannedJobs(matrix)).toThrow(/include/);
    },
  );

  it('returns an empty list for an empty include', () => {
    expect(plannedJobs('{"include":[]}')).toEqual([]);
  });

  it('refuses a matrix that is not JSON', () => {
    expect(() => plannedJobs('nope')).toThrow();
  });
});

describe('the command', () => {
  const media = () => plan(realRepo, { projects: 'media' });
  const run = (
    matrix: unknown,
    result: string,
    extra: Record<string, string> = {},
  ) =>
    spawnSync('node', [summaryScript, join(dir, 'reports')], {
      cwd: realRepo,
      encoding: 'utf8',
      env: {
        ...process.env,
        MATRIX:
          typeof matrix === 'string'
            ? matrix
            : JSON.stringify({ include: matrix }),
        RESULT: result,
        ...extra,
      },
    });
  const put = (path: string, content: unknown) => {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), JSON.stringify(content));
  };

  it('exits 0 and writes the job summary table when media scores 100', () => {
    put('reports/mutation-media/media/score.json', record('media', '', 10, 0));
    const summary = join(dir, 'summary.md');

    const result = run(media(), 'success', { GITHUB_STEP_SUMMARY: summary });

    expect(result.status).toBe(0);
    expect(readFileSync(summary, 'utf8')).toMatch(/\| media \| 100\.00% \|/);
  });

  it('exits 1 naming the project, its score and its floor when under the floor', () => {
    put('reports/mutation-media/media/score.json', record('media', '', 1, 99));

    const result = run(media(), 'success');

    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/media: 1\.00% is under its floor of \d+/);
  });

  it('exits 1 naming a planned job whose directory was never downloaded', () => {
    const result = run(media(), 'failure');

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('media: no score');
  });

  it('exits 1 when the plan job failed and left no matrix', () => {
    const result = run('', 'skipped');

    expect(result.status).toBe(1);
  });

  it('does not fail on a partial score of a sharded project', () => {
    const rest = plan(realRepo, { shards: 'domain:rest' });
    put(
      'reports/mutation-domain-rest/domain/rest/score.json',
      record('domain', 'rest', 0, 50),
    );

    const result = run(rest, 'success');

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/partial/);
  });

  it('fails a matrix naming a project that is not in the repository', () => {
    const result = run([entry('ghost')], 'success');

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/ghost/);
  });
});
