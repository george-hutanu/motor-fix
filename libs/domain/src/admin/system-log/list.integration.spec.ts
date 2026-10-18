import { randomUUID } from 'node:crypto';

import { BadRequestException } from '@nestjs/common';

import { listSystemLog } from './list';
import { createPrisma } from '../../auth/prisma';
import { serialDatabase } from '../../auth/serial-db.testing';
import { Prisma, type PrismaClient } from '../../generated/prisma/client';
import { databaseUrl } from '../../notifications/notifications.testing';
import { encodeCursor } from '../cursor';

serialDatabase(databaseUrl);

const prisma = createPrisma(databaseUrl);
const NOW = new Date('2026-10-17T12:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const entry = async (
  at: Date,
  extra: Partial<{
    id: string;
    kind: string;
    source: string;
    severity: string;
    message: string;
    context: object;
  }> = {},
) => {
  const row = {
    context: {},
    id: randomUUID(),
    kind: 'deploy',
    message: 'Deployed v1.',
    severity: 'info',
    source: 'worker',
    ...extra,
  };
  await prisma.$executeRawUnsafe(
    `INSERT INTO system_log_entry
       (id, at, minute, kind, source, severity, fingerprint, message, context)
     VALUES ($1::uuid, $2, date_trunc('minute', $2::timestamptz), $3::system_log_kind,
       $4::system_log_source, $5::system_log_severity, $6, $7, $8::jsonb)`,
    row.id,
    at,
    row.kind,
    row.source,
    row.severity,
    randomUUID(),
    row.message,
    JSON.stringify(row.context),
  );
  return row.id;
};

const since = (days: number) => new Date(NOW.getTime() - days * DAY);
const read = (query: Parameters<typeof listSystemLog>[1]) =>
  listSystemLog(prisma, query, NOW);
const ids = (page: { items: { id: string }[] }) =>
  page.items.map((item) => item.id);

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE system_log_entry');
});

afterAll(async () => {
  await prisma.$disconnect();
});

// @traces 299-FR-001 299-FR-002
describe('paging the whole log', () => {
  it('reads 120 entries newest first in pages of 50 with no gap and no repeat', async () => {
    const written: string[] = [];
    for (let n = 0; n < 120; n += 1) {
      written.push(await entry(new Date(NOW.getTime() - n * 2 * HOUR)));
    }
    const from = since(10).toISOString();

    const first = await read({ from, limit: 50 });
    const second = await read({
      cursor: first.nextCursor ?? '',
      from,
      limit: 50,
    });
    const third = await read({
      cursor: second.nextCursor ?? '',
      from,
      limit: 50,
    });

    expect([
      first.items.length,
      second.items.length,
      third.items.length,
    ]).toEqual([50, 50, 20]);
    expect([...ids(first), ...ids(second), ...ids(third)]).toEqual(written);
    expect(third.nextCursor).toBeNull();
  });

  it('pages twenty when no limit is asked', async () => {
    for (let n = 0; n < 25; n += 1)
      await entry(new Date(NOW.getTime() - n * HOUR));

    const page = await read({ from: since(2).toISOString() });

    expect(page.items).toHaveLength(20);
    expect(page.nextCursor).not.toBeNull();
  });

  it('splits two entries of one instant across pages without losing either', async () => {
    const at = new Date(NOW.getTime() - HOUR);
    const both = [await entry(at), await entry(at)].sort().reverse();
    const from = since(1).toISOString();

    const first = await read({ from, limit: 1 });
    const second = await read({
      cursor: first.nextCursor ?? '',
      from,
      limit: 1,
    });

    expect([...ids(first), ...ids(second)]).toEqual(both);
  });

  it('keeps the next page stable when a newer entry arrives between pages', async () => {
    const older = await entry(new Date(NOW.getTime() - 3 * HOUR));
    const newer = await entry(new Date(NOW.getTime() - 2 * HOUR));
    const from = since(1).toISOString();

    const first = await read({ from, limit: 1 });
    await entry(new Date(NOW.getTime() - HOUR));
    const second = await read({
      cursor: first.nextCursor ?? '',
      from,
      limit: 1,
    });

    expect(ids(first)).toEqual([newer]);
    expect(ids(second)).toEqual([older]);
    expect(second.nextCursor).toBeNull();
  });

  it('answers no next page when the last page is exactly full', async () => {
    await entry(new Date(NOW.getTime() - HOUR));
    await entry(new Date(NOW.getTime() - 2 * HOUR));

    expect(
      (await read({ from: since(1).toISOString(), limit: 2 })).nextCursor,
    ).toBeNull();
  });

  it('gives each entry its time, source, severity, kind, message, context and count', async () => {
    const at = new Date(NOW.getTime() - HOUR);
    const id = await entry(at, {
      context: { job: 'quote-expiry' },
      kind: 'job_failed',
      message: 'Job quote-expiry failed.',
      severity: 'error',
      source: 'worker',
    });

    expect((await read({ from: since(1).toISOString() })).items).toEqual([
      {
        at: at.toISOString(),
        context: { job: 'quote-expiry' },
        count: 1,
        id,
        kind: 'job_failed',
        message: 'Job quote-expiry failed.',
        severity: 'error',
        source: 'worker',
      },
    ]);
  });
});

// @traces 299-FR-002 299-FR-003
describe('the range and the cursor', () => {
  it('leaves out an entry at the end instant and keeps one at the start', async () => {
    const from = new Date(NOW.getTime() - 2 * DAY);
    const to = new Date(NOW.getTime() - DAY);
    const atStart = await entry(from);
    await entry(to);

    const page = await read({ from: from.toISOString(), to: to.toISOString() });

    expect(ids(page)).toEqual([atStart]);
  });

  it('clamps a start older than ninety days to ninety days ago', async () => {
    await entry(since(91));
    const kept = await entry(since(89));

    const page = await read({ from: since(200).toISOString() });

    expect(ids(page)).toEqual([kept]);
  });

  it('refuses an end not after the start before clamping', async () => {
    const from = since(200).toISOString();

    await expect(read({ from, to: from })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      read({ from, to: since(201).toISOString() }),
    ).rejects.toMatchObject({ response: { code: 'validation_failed' } });
  });

  it('answers an empty page when the clamped range starts at or after its end', async () => {
    await entry(since(100));

    expect(
      await read({
        from: since(200).toISOString(),
        to: since(95).toISOString(),
      }),
    ).toEqual({ items: [], nextCursor: null });
  });

  it.each([
    ['words', 'not-a-cursor'],
    ['two words', Buffer.from('x|y').toString('base64url')],
  ])('refuses a cursor made of %s', async (_, cursor) => {
    await expect(
      read({ cursor, from: since(1).toISOString() }),
    ).rejects.toMatchObject({ response: { code: 'validation_failed' } });
  });

  it('reads on from a cursor made for any entry', async () => {
    const at = new Date(NOW.getTime() - 2 * HOUR);
    const older = await entry(new Date(NOW.getTime() - 3 * HOUR));
    await entry(new Date(NOW.getTime() - HOUR));

    const page = await read({
      cursor: encodeCursor(at, randomUUID()),
      from: since(1).toISOString(),
    });

    expect(ids(page)).toEqual([older]);
  });
});

// @traces 299-FR-001
describe('narrowing by type, severity and source', () => {
  const day = (n: number) => new Date(Date.UTC(2026, 9, n, 9));

  beforeEach(async () => {
    await entry(day(1), {
      kind: 'backup_failed',
      severity: 'error',
      source: 'backup',
    });
    await entry(day(2), {
      kind: 'backup_completed',
      severity: 'info',
      source: 'backup',
    });
    await entry(day(3), {
      kind: 'backup_failed',
      severity: 'error',
      source: 'backup',
    });
    await entry(day(4), {
      kind: 'backup_failed',
      severity: 'error',
      source: 'backup',
    });
    await entry(day(2), {
      kind: 'job_failed',
      severity: 'error',
      source: 'worker',
    });
    await entry(day(3), {
      kind: 'service_error',
      severity: 'warning',
      source: 'email',
    });
  });

  const kinds = async (query: Omit<Parameters<typeof read>[0], 'from'>) =>
    (
      await read({
        from: new Date(Date.UTC(2026, 8, 30)).toISOString(),
        ...query,
      })
    ).items
      .map((item) => `${item.kind}@${item.at.slice(8, 10)}`)
      .sort();

  it('keeps one kind', async () => {
    expect(await kinds({ kind: ['job_failed'] })).toEqual(['job_failed@02']);
  });

  it('keeps any of several kinds', async () => {
    expect(await kinds({ kind: ['job_failed', 'service_error'] })).toEqual([
      'job_failed@02',
      'service_error@03',
    ]);
  });

  it('keeps one severity', async () => {
    expect(await kinds({ severity: ['warning'] })).toEqual([
      'service_error@03',
    ]);
  });

  it('keeps any of several sources', async () => {
    expect(await kinds({ source: ['email', 'worker'] })).toEqual([
      'job_failed@02',
      'service_error@03',
    ]);
  });

  it('combines type, severity and dates', async () => {
    expect(
      await read({
        from: new Date(Date.UTC(2026, 9, 1)).toISOString(),
        kind: ['backup_completed', 'backup_failed'],
        severity: ['error'],
        to: new Date(Date.UTC(2026, 9, 4)).toISOString(),
      }).then((page) => page.items.map((item) => item.at.slice(0, 10))),
    ).toEqual(['2026-10-03', '2026-10-01']);
  });
});

// @traces 299-FR-004
describe('searching the text', () => {
  const found = async (
    q: string,
    extra: Partial<Parameters<typeof read>[0]> = {},
  ) =>
    (await read({ from: since(1).toISOString(), q, ...extra })).items
      .map((item) => item.message)
      .sort();
  const at = (n: number) => new Date(NOW.getTime() - n * HOUR);

  beforeEach(async () => {
    await entry(at(1), {
      kind: 'service_error',
      message: 'Brevo answered 503.',
      source: 'email',
    });
    await entry(at(2), {
      kind: 'check_failed',
      message: 'BREVO check failed.',
      source: 'email',
    });
    await entry(at(3), {
      message: 'Răspuns târziu de la hartă.',
      source: 'maps',
    });
    await entry(at(4), { message: 'Copied 100% of files_x.' });
    await entry(at(5), { message: 'Copied 1000 of filesyx.' });
    await entry(at(6), { message: 'Path C:\\backup done.' });
    await entry(at(7), {
      context: { provider: 'brevo' },
      message: 'Deployed v2.',
    });
  });

  it('ignores case', async () => {
    expect(await found('brevo')).toEqual([
      'BREVO check failed.',
      'Brevo answered 503.',
    ]);
    expect(await found('BREVO')).toEqual([
      'BREVO check failed.',
      'Brevo answered 503.',
    ]);
  });

  it('ignores diacritics on both sides', async () => {
    expect(await found('tarziu')).toEqual(['Răspuns târziu de la hartă.']);
    expect(await found('hărta')).toEqual(['Răspuns târziu de la hartă.']);
  });

  it('reads %, _ and \\ as plain characters', async () => {
    expect(await found('100%')).toEqual(['Copied 100% of files_x.']);
    expect(await found('s_x')).toEqual(['Copied 100% of files_x.']);
    expect(await found('C:\\b')).toEqual(['Path C:\\backup done.']);
  });

  it('never matches the context or an id', async () => {
    expect(await found('Deployed v2')).toEqual(['Deployed v2.']);
    expect(await found('provider')).toEqual([]);
  });

  it('combines with a kind', async () => {
    expect(await found('brevo', { kind: ['check_failed'] })).toEqual([
      'BREVO check failed.',
    ]);
  });
});

// @traces 299-FR-002 299-FR-003
describe('the indexes a narrowed read uses', () => {
  // The query the list sends, planned instead of run, over enough entries
  // that the planner prefers a selective index to walking the range.
  const planOf = async (query: Omit<Parameters<typeof read>[0], 'from'>) => {
    let sent: Prisma.Sql | undefined;
    const capture = {
      $queryRaw: async (
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => {
        sent = Prisma.sql(strings, ...values);
        return [];
      },
    } as unknown as PrismaClient;
    await listSystemLog(
      capture,
      { from: since(80).toISOString(), ...query },
      NOW,
    );
    const rows = await prisma.$queryRaw<
      { 'QUERY PLAN': string }[]
    >`EXPLAIN ${sent}`;
    return rows.map((row) => row['QUERY PLAN']).join('\n');
  };

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO system_log_entry
        (id, at, minute, kind, source, severity, fingerprint, message)
      SELECT gen_random_uuid(), at, date_trunc('minute', at), 'deploy', 'worker',
        'info', n::text, 'Deployed v' || n
      FROM generate_series(1, 30000) AS n,
        LATERAL (SELECT $1::timestamptz - n * interval '1 minute' AS at) AS t`,
      NOW,
    );
    await entry(since(1), {
      kind: 'job_failed',
      message: 'Reîncercare eșuată.',
    });
    await prisma.$executeRawUnsafe('ANALYZE system_log_entry');
  });

  it('reads the kind through an index on it', async () => {
    expect(await planOf({ kind: ['job_failed'] })).toMatch(
      /Index Cond: \(kind = ANY \('\{job_failed\}'::system_log_kind\[\]\)\)/,
    );
  });

  it('reads the folded search through its trigram index', async () => {
    expect(await planOf({ q: 'reincercare' })).toContain(
      'system_log_entry_message_fold_trgm_idx',
    );
  });
});
