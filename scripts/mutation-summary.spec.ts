// @traces 1159-FR-007 1159-FR-008
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Entry } from './mutation-plan.ts';
import {
  plannedJobs,
  readScores,
  summarize,
  table,
} from './mutation-summary.ts';

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

const floors = { domain: 60, media: 85 };
const floorOf = (project: string) => floors[project as keyof typeof floors];

const domain = [entry('domain', 'auth'), entry('domain', 'rest')];
const media = [entry('media')];

describe('summarize', () => {
  it('combines killed and timed-out over valid mutants, summed over the shards', () => {
    const { problems, rows } = summarize({
      floorOf,
      full: [...domain, ...media],
      planned: [...domain, ...media],
      records: [
        record('domain', 'auth', 50, 30, { minutes: 70, timeout: 10 }),
        record('domain', 'rest', 20, 0, { minutes: 30, noCoverage: 10 }),
        record('media', '', 9, 1),
      ],
      result: 'success',
    });

    expect(problems).toEqual([]);
    expect(rows).toEqual([
      {
        complete: true,
        floor: 60,
        minutes: 100,
        project: 'domain',
        score: 66.67,
        shards: ['auth', 'rest'],
      },
      {
        complete: true,
        floor: 85,
        minutes: 10,
        project: 'media',
        score: 90,
        shards: [''],
      },
    ]);
  });

  it('fails a project whose shards all ran and whose combined score is under its floor', () => {
    const { problems } = summarize({
      floorOf,
      full: domain,
      planned: domain,
      records: [
        record('domain', 'auth', 50, 50),
        record('domain', 'rest', 5, 5),
      ],
      result: 'success',
    });

    expect(problems).toEqual(['domain: 50.00% is under its floor of 60']);
  });

  it('does not hold a project to its floor when only some of its shards ran', () => {
    const { problems, rows } = summarize({
      floorOf,
      full: domain,
      planned: [entry('domain', 'auth')],
      records: [record('domain', 'auth', 1, 9)],
      result: 'success',
    });

    expect(problems).toEqual([]);
    expect(rows[0]).toEqual(
      expect.objectContaining({ complete: false, score: 10 }),
    );
  });

  it('names every planned job that left no score', () => {
    const { problems } = summarize({
      floorOf,
      full: [...domain, ...media],
      planned: [...domain, ...media],
      records: [record('domain', 'auth', 9, 1)],
      result: 'failure',
    });

    expect(problems).toEqual(
      expect.arrayContaining([
        'domain-rest: no score; the job failed or was cut off',
        'media: no score; the job failed or was cut off',
      ]),
    );
  });

  it('fails when a matrix job did not succeed even though every job left a score', () => {
    const { problems } = summarize({
      floorOf,
      full: media,
      planned: media,
      records: [record('media', '', 9, 1)],
      result: 'failure',
    });

    expect(problems).toEqual(['a mutation job ended with failure']);
  });

  it('counts a skipped job as not run, so its project is partial', () => {
    const { problems, rows } = summarize({
      floorOf,
      full: domain,
      planned: domain,
      records: [
        record('domain', 'auth', 1, 9),
        { project: 'domain', shard: 'rest', skipped: true },
      ],
      result: 'success',
    });

    expect(problems).toEqual([]);
    expect(rows[0]).toEqual(
      expect.objectContaining({ complete: false, shards: ['auth'] }),
    );
  });

  it('gives no score to a project with no valid mutant', () => {
    const { problems, rows } = summarize({
      floorOf,
      full: media,
      planned: media,
      records: [record('media', '', 0, 0)],
      result: 'success',
    });

    expect(problems).toEqual([]);
    expect(rows[0]?.score).toBeNull();
  });
});

describe('table', () => {
  it('writes one line per project with score, floor, shards run and minutes', () => {
    expect(
      table([
        {
          complete: true,
          floor: 60,
          minutes: 100,
          project: 'domain',
          score: 66.67,
          shards: ['auth', 'rest'],
        },
        {
          complete: false,
          floor: 85,
          minutes: 0.5,
          project: 'media',
          score: null,
          shards: [],
        },
      ]),
    ).toBe(
      '| Project | Mutation score | Floor | Shards run | Minutes |\n' +
        '|---|---|---|---|---|\n' +
        '| domain | 66.67% | 60 | auth, rest | 100.0 |\n' +
        '| media | n/a (partial, not held to the floor) | 85 | none | 0.5 |\n',
    );
  });
});

describe('readScores', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mutation-summary-'));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  it('reads every score.json under the downloaded artifacts', () => {
    mkdirSync(join(dir, 'mutation-domain-auth/domain/auth'), {
      recursive: true,
    });
    mkdirSync(join(dir, 'mutation-media/media'), { recursive: true });
    writeFileSync(
      join(dir, 'mutation-domain-auth/domain/auth/score.json'),
      JSON.stringify(record('domain', 'auth', 1, 0)),
    );
    writeFileSync(
      join(dir, 'mutation-media/media/score.json'),
      JSON.stringify(record('media', '', 1, 0)),
    );
    writeFileSync(join(dir, 'mutation-media/media/index.html'), '');

    expect(
      readScores(dir)
        .map((r) => `${r.project}:${r.shard}`)
        .sort(),
    ).toEqual(['domain:auth', 'media:']);
  });

  it('reads nothing from a folder that is not there', () => {
    expect(readScores(join(dir, 'missing'))).toEqual([]);
  });
});

describe('plannedJobs', () => {
  it('reads the include list of the plan job matrix', () => {
    expect(plannedJobs('{"include":[{"id":"media"}]}')).toEqual([
      { id: 'media' },
    ]);
  });

  // A failed plan job leaves MATRIX empty.
  it.each([undefined, '', '{}'])(
    'names the missing list when MATRIX is %j',
    (matrix) => {
      expect(() => plannedJobs(matrix)).toThrow('MATRIX holds no include list');
    },
  );
});
