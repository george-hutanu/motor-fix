import { SeverityNumber } from '@opentelemetry/api-logs';

import {
  foldConnections,
  logSlowStatements,
  readPostgres,
  type SlowRow,
  slowStatements,
} from './postgres';
import { startTelemetry } from '../setup/start';
import { inMemory } from '../testing/in-memory';

const memory = inMemory();
const started = startTelemetry(
  'worker',
  { APP_ENV: 'staging', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' },
  memory,
);
afterAll(() => started?.shutdown());
beforeEach(async () => {
  await started?.flush();
  memory.logExporter.reset();
});

const slow = (queryid: string, calls: number, mean = 800): SlowRow => ({
  calls,
  max_exec_time: mean * 2,
  mean_exec_time: mean,
  query: `SELECT 1 /* ${queryid} */`,
  queryid,
});

const STATS = {
  commit: 1,
  deadlocks: 0,
  locks: 0,
  max: 100,
  rollback: 0,
  size: 10,
};

function session(
  stats: () => Promise<unknown[]> = async () => [STATS],
  slowRows: () => Promise<unknown[]> = async () => [],
  connections: () => Promise<unknown[]> = async () => [],
) {
  return {
    query: <T>(text: string): Promise<T[]> =>
      (text.includes('pg_stat_statements')
        ? slowRows()
        : text.includes('GROUP BY')
          ? connections()
          : stats()) as Promise<T[]>,
  };
}

describe('foldConnections under hostile rows', () => {
  it('keeps the total finite when a count is not a number', () => {
    const folded = foldConnections([
      { count: 'abc', state: 'active' },
      { count: 2, state: 'active' },
    ]);
    expect(Number.isFinite(folded.active)).toBe(true);
  });

  it('files an unknown, empty or differently cased state under other', () => {
    expect(
      foldConnections([
        { count: 1, state: 'ACTIVE' },
        { count: 1, state: '' },
        { count: 1, state: 'disabled' },
        { count: 1, state: 'activé' },
      ]),
    ).toEqual({ active: 0, idle: 0, idle_in_transaction: 0, other: 4 });
  });

  it('adds up ten thousand rows', () => {
    const rows = Array.from({ length: 10_000 }, () => ({
      count: 1,
      state: 'idle',
    }));
    expect(foldConnections(rows).idle).toBe(10_000);
  });
});

describe('slowStatements with queryid churn', () => {
  it('forgets statements that left the view so the baseline does not grow', () => {
    let baseline = slowStatements([slow('a', 1)], undefined).baseline;
    for (let i = 0; i < 100; i++) {
      baseline = slowStatements([slow(`q${i}`, 1)], baseline).baseline;
    }
    expect(Object.keys(baseline)).toEqual(['q99']);
  });

  it('counts a statement under a new queryid as new each time it churns', () => {
    const first = slowStatements([slow('a', 4)], {});
    const second = slowStatements([slow('b', 4)], first.baseline);
    expect(second.count).toBe(1);
  });

  it('does not count a statement whose calls fell after a statistics reset', () => {
    const result = slowStatements([slow('a', 2)], { a: 50 });
    expect(result.count).toBe(0);
    expect(result.baseline).toEqual({ a: 2 });
  });

  it('then counts it again once its calls pass the lowered baseline', () => {
    const reset = slowStatements([slow('a', 2)], { a: 50 });
    expect(slowStatements([slow('a', 3)], reset.baseline).count).toBe(1);
  });

  it('counts nothing when the same rows are read twice', () => {
    const rows = [slow('a', 5), slow('b', 7)];
    const first = slowStatements(rows, undefined);
    expect(slowStatements(rows, first.baseline).count).toBe(0);
  });

  it('counts nothing on a second reading of a queryid shared by two roles', () => {
    const rows = [slow('a', 5), slow('a', 9)];
    const first = slowStatements(rows, undefined);
    expect(slowStatements(rows, first.baseline).count).toBe(0);
  });

  it("counts nothing when two roles' rows of one queryid come back in another order", () => {
    const first = slowStatements([slow('a', 9), slow('a', 5)], undefined);
    expect(
      slowStatements([slow('a', 5), slow('a', 9)], first.baseline).count,
    ).toBe(0);
    expect(
      slowStatements([slow('a', 9), slow('a', 5)], first.baseline).count,
    ).toBe(0);
  });

  it('counts a queryid shared by two roles once, when either role ran it again', () => {
    const first = slowStatements([slow('a', 5), slow('a', 9)], undefined);
    const second = slowStatements([slow('a', 6), slow('a', 9)], first.baseline);
    expect(second.count).toBe(1);
    expect(second.grown).toEqual([
      expect.objectContaining({ calls: 15, queryid: 'a' }),
    ]);
  });

  it('reports 0 and an empty baseline for an empty view', () => {
    expect(slowStatements([], undefined)).toEqual({
      baseline: {},
      count: 0,
      grown: [],
    });
  });

  it('reads calls arriving as strings as numbers', () => {
    const rows = [{ ...slow('a', 0), calls: '12' as unknown as number }];
    expect(slowStatements(rows, { a: 12 }).count).toBe(0);
    expect(slowStatements(rows, { a: 11 }).count).toBe(1);
  });

  it('logs at most ten of a thousand growing statements and counts all of them', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => slow(String(i), 2));
    const result = slowStatements(rows, {});
    expect(result.count).toBe(1000);
    expect(result.grown).toHaveLength(10);
  });

  it('does not let a NaN mean time displace the slowest statements', () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => slow(`s${i}`, 2, 900 + i)),
      { ...slow('bad', 2), mean_exec_time: Number.NaN },
    ];
    const ids = slowStatements(rows, {}).grown.map((row) => row.queryid);
    expect(ids).not.toContain('bad');
  });
});

describe('logSlowStatements masking', () => {
  it('masks an e-mail, a phone number and a plate in the statement text', async () => {
    logSlowStatements([
      {
        ...slow('1', 1),
        query:
          "SELECT 1 WHERE e = 'ana.pop@example.com' OR p = '+40712345678' OR r = 'B 123 ABC'",
      },
    ]);
    await started?.flush();
    const text = String(
      memory.logExporter.getFinishedLogRecords()[0]?.attributes['query'],
    );
    expect(text).not.toContain('ana.pop@example.com');
    expect(text).not.toContain('40712345678');
    expect(text).not.toContain('B 123 ABC');
  });

  it('writes no record for an empty list', async () => {
    logSlowStatements([]);
    await started?.flush();
    expect(memory.logExporter.getFinishedLogRecords()).toEqual([]);
  });

  it('writes WARN records for unicode statement text', async () => {
    logSlowStatements([
      { ...slow('1', 1), query: "SELECT 'Șoseaua Ștefan' -- 🚗" },
    ]);
    await started?.flush();
    const [record] = memory.logExporter.getFinishedLogRecords();
    expect(record?.severityNumber).toBe(SeverityNumber.WARN);
    expect(record?.attributes['query']).toContain('🚗');
  });
});

describe('readPostgres failing dependencies', () => {
  it('reads zeros when the statistics SELECT returns no row', async () => {
    const { reading } = await readPostgres(
      session(async () => []),
      undefined,
    );
    expect(reading.databaseSizeBytes).toBe(0);
    expect(reading.transactions).toEqual({ commit: 0, rollback: 0 });
  });

  it('keeps every figure finite when the statistics row holds nulls and text', async () => {
    const { reading } = await readPostgres(
      session(async () => [
        {
          commit: null,
          deadlocks: 'x',
          locks: undefined,
          max: 'NaN',
          rollback: '',
          size: null,
        },
      ]),
      undefined,
    );
    for (const figure of [
      reading.connectionsMax,
      reading.databaseSizeBytes,
      reading.deadlocks,
      reading.locksWaiting,
      reading.transactions.commit,
      reading.transactions.rollback,
    ]) {
      expect(Number.isFinite(figure)).toBe(true);
    }
  });

  it('rejects when the query function throws synchronously', async () => {
    const boom = new Error('socket closed');
    const db = {
      query: () => {
        throw boom;
      },
    };
    await expect(readPostgres(db as never, undefined)).rejects.toBe(boom);
  });

  it('rejects, rather than hiding it, when the statement view fails with another code', async () => {
    const db = session(undefined, async () => {
      throw Object.assign(new Error('permission denied'), { code: '42501' });
    });
    await expect(readPostgres(db, undefined)).rejects.toThrow(
      'permission denied',
    );
  });

  it('rejects when the statistics SELECT fails even though the others answer', async () => {
    const db = session(async () => {
      throw new Error('terminating connection');
    });
    await expect(readPostgres(db, { a: 1 })).rejects.toThrow(
      'terminating connection',
    );
  });

  it('leaves the baseline untouched when the view cannot be read', async () => {
    const db = session(undefined, async () => {
      throw Object.assign(new Error('not loaded'), { code: '55000' });
    });
    const baseline = { a: 3 };
    const result = await readPostgres(db, baseline);
    expect(result.baseline ?? baseline).toEqual({ a: 3 });
    expect(result.reading.slowStatements).toBeUndefined();
  });

  it('survives the view answering an error without a code', async () => {
    const db = session(undefined, async () => {
      throw 'plain string';
    });
    await expect(readPostgres(db, undefined)).rejects.toBe('plain string');
  });
});
