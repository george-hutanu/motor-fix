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
  query: `SELECT ${queryid} FROM garage WHERE id = $1`,
  queryid,
});

const STATS = {
  commit: 900,
  deadlocks: 2,
  locks: 1,
  max: 100,
  rollback: 12,
  size: 52_428_800,
};

// A monitoring session answering each catalogue SELECT by what it reads.
function session(answers: {
  connections?: () => Promise<unknown[]>;
  slow?: () => Promise<unknown[]>;
  stats?: () => Promise<unknown[]>;
}) {
  const sql: string[] = [];
  return {
    query: <T>(text: string): Promise<T[]> => {
      sql.push(text);
      const answer = text.includes('pg_stat_statements')
        ? (answers.slow ?? (async () => []))
        : text.includes('GROUP BY')
          ? (answers.connections ??
            (async () => [{ count: 3, state: 'active' }]))
          : (answers.stats ?? (async () => [STATS]));
      return answer() as Promise<T[]>;
    },
    sql,
  };
}

// @traces 878-FR-003
describe('foldConnections', () => {
  it('folds the session states into active, idle, idle in transaction and other', () => {
    expect(
      foldConnections([
        { count: 4, state: 'active' },
        { count: 10, state: 'idle' },
        { count: 2, state: 'idle in transaction' },
        { count: 1, state: 'idle in transaction (aborted)' },
        { count: 1, state: 'fastpath function call' },
        { count: '3', state: null },
      ]),
    ).toEqual({ active: 4, idle: 10, idle_in_transaction: 2, other: 5 });
  });

  it('reports every state, at 0 when no session is in it', () => {
    expect(foldConnections([])).toEqual({
      active: 0,
      idle: 0,
      idle_in_transaction: 0,
      other: 0,
    });
  });
});

// @traces 878-FR-004
describe('slowStatements', () => {
  it('only records the baseline on the first reading and reports 0', () => {
    const result = slowStatements([slow('1', 5)], undefined);
    expect(result.count).toBe(0);
    expect(result.grown).toEqual([]);
    expect(result.baseline).toEqual({ '1': 5 });
  });

  it('counts the statements whose calls grew or that are new since the previous reading', () => {
    const result = slowStatements([slow('1', 5), slow('2', 9), slow('3', 1)], {
      '1': 5,
      '2': 4,
    });
    expect(result.count).toBe(2);
    expect(result.grown.map((row) => row.queryid).sort()).toEqual(['2', '3']);
    expect(result.baseline).toEqual({ '1': 5, '2': 9, '3': 1 });
  });

  it('keeps at most 10 to log, slowest first, while counting them all', () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      slow(String(i), 1, 600 + i * 10),
    );
    const result = slowStatements(rows, {});
    expect(result.count).toBe(12);
    expect(result.grown).toHaveLength(10);
    expect(result.grown.map((row) => row.mean_exec_time)).toEqual(
      [...rows]
        .reverse()
        .slice(0, 10)
        .map((row) => row.mean_exec_time),
    );
  });
});

// @traces 878-FR-004
// @traces 878-FR-012
describe('logSlowStatements', () => {
  it('writes one WARN record per statement with the masked text, the times and the calls', async () => {
    logSlowStatements([
      {
        calls: 3,
        max_exec_time: 1_250.5,
        mean_exec_time: 701.25,
        query: "SELECT id FROM account WHERE email = 'ana@example.com'",
        queryid: '77',
      },
    ]);
    await started?.flush();

    const records = memory.logExporter.getFinishedLogRecords();
    expect(records).toHaveLength(1);
    expect(records[0]?.body).toBe('slow statement');
    expect(records[0]?.severityNumber).toBe(SeverityNumber.WARN);
    expect(records[0]?.attributes).toEqual({
      calls: 3,
      max_ms: 1_250.5,
      mean_ms: 701.25,
      query: "SELECT id FROM account WHERE email = '***'",
    });
  });
});

// @traces 878-FR-003
// @traces 878-FR-004
// @traces 878-FR-008
describe('readPostgres', () => {
  it('reads the connections, the limit, the lock waits, the size, the transactions and the deadlocks', async () => {
    const db = session({});
    const { reading } = await readPostgres(db, undefined);
    expect(reading).toEqual({
      connections: { active: 3, idle: 0, idle_in_transaction: 0, other: 0 },
      connectionsMax: 100,
      databaseSizeBytes: 52_428_800,
      deadlocks: 2,
      locksWaiting: 1,
      slowStatements: 0,
      transactions: { commit: 900, rollback: 12 },
    });
  });

  it('issues only SELECTs on the statistics views', async () => {
    const db = session({});
    await readPostgres(db, undefined);
    expect(db.sql.length).toBeGreaterThan(0);
    for (const text of db.sql) {
      expect(text.trim()).toMatch(/^SELECT\b/i);
      expect(text).not.toMatch(
        /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|pg_stat_statements_reset)\b/i,
      );
    }
  });

  it('counts slow statements against the previous reading and hands back the ones to log', async () => {
    const db = session({ slow: async () => [slow('1', 6), slow('2', 2)] });
    const result = await readPostgres(db, { '1': 5, '2': 2 });
    expect(result.reading.slowStatements).toBe(1);
    expect(result.slow.map((row) => row.queryid)).toEqual(['1']);
    expect(result.baseline).toEqual({ '1': 6, '2': 2 });
  });

  it.each([
    ['55000', 'pg_stat_statements must be loaded via shared_preload_libraries'],
    ['42P01', 'relation "pg_stat_statements" does not exist'],
  ])(
    'reports the rest and no slow figure when the view answers %s',
    async (code, message) => {
      const db = session({
        slow: async () => {
          throw Object.assign(new Error(message), { code });
        },
      });
      const result = await readPostgres(db, { '1': 1 });
      expect(result.reading.slowStatements).toBeUndefined();
      expect(result.reading.connectionsMax).toBe(100);
      expect(result.viewError).toContain(message);
      expect(result.baseline).toEqual({ '1': 1 });
    },
  );

  it('fails the reading on any other error', async () => {
    const db = session({
      stats: async () => {
        throw Object.assign(new Error('connection terminated'), {
          code: '57P01',
        });
      },
    });
    await expect(readPostgres(db, undefined)).rejects.toThrow(
      'connection terminated',
    );
  });

  it('fails the reading when the statement view fails for another reason', async () => {
    const db = session({
      slow: async () => {
        throw Object.assign(
          new Error('canceling statement due to statement timeout'),
          {
            code: '57014',
          },
        );
      },
    });
    await expect(readPostgres(db, undefined)).rejects.toThrow(
      'statement timeout',
    );
  });
});
