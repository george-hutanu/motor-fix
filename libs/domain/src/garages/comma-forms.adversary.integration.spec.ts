import { serialDatabase } from '../auth/serial-db.testing';
import { databaseUrl, fixtures } from '../notifications/notifications.testing';

// @traces 1185-FR-001
// @traces 1185-FR-002
// @traces 1185-FR-003
// @traces 1185-FR-004

const { prisma } = fixtures();
serialDatabase(databaseUrl);

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE garage CASCADE');
});

afterAll(async () => {
  await prisma.$disconnect();
});

const select = async <T>(sql: string, ...params: unknown[]) =>
  prisma.$queryRawUnsafe<T[]>(sql, ...params);

const fold = async (value: string | null) =>
  (
    await select<{ v: string | null }>(
      'SELECT f_unaccent($1::text) AS v',
      value,
    )
  )[0].v;

const accountFold = async (value: string | null) =>
  (
    await select<{ v: string | null }>(
      'SELECT account_fold($1::text) AS v',
      value,
    )
  )[0].v;

// A row as it was before the trigger existed; the trigger is back on whatever
// the insert does.
const withoutTrigger = async (sql: string) => {
  await prisma.$executeRawUnsafe(
    'ALTER TABLE garage DISABLE TRIGGER garage_comma_forms',
  );
  try {
    await prisma.$executeRawUnsafe(sql);
  } finally {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE garage ENABLE TRIGGER garage_comma_forms',
    );
  }
};

const nameOf = async (slug: string) =>
  (
    await select<{ name: string }>(
      'SELECT name FROM garage WHERE slug = $1',
      slug,
    )
  )[0].name;

describe('a garage written through other Prisma paths', () => {
  it('converts the name on both sides of an upsert', async () => {
    await prisma.garage.upsert({
      create: { name: 'Ţară', slug: 'up' },
      update: { name: 'Şosea' },
      where: { slug: 'up' },
    });
    expect(await nameOf('up')).toBe('Țară');

    await prisma.garage.upsert({
      create: { name: 'x', slug: 'up' },
      update: { name: 'Şosea' },
      where: { slug: 'up' },
    });
    expect(await nameOf('up')).toBe('Șosea');
  });

  it('converts every row of a createMany', async () => {
    await prisma.garage.createMany({
      data: [
        { name: 'Ş1', slug: 'm1' },
        { name: 'plain', slug: 'm2' },
        { name: 'Ţ3', slug: 'm3' },
      ],
    });

    expect(await select('SELECT name FROM garage ORDER BY slug')).toEqual([
      { name: 'Ș1' },
      { name: 'plain' },
      { name: 'Ț3' },
    ]);
  });

  it('converts every row of an updateMany', async () => {
    await prisma.garage.createMany({
      data: [
        { name: 'a', slug: 'u1' },
        { name: 'b', slug: 'u2' },
      ],
    });

    await prisma.garage.updateMany({ data: { name: 'Şţ' } });

    expect(await select('SELECT name FROM garage')).toEqual([
      { name: 'Șț' },
      { name: 'Șț' },
    ]);
  });
});

describe('a garage written through plain SQL', () => {
  it('converts the excluded row of an ON CONFLICT update', async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO garage (id, name, slug) VALUES (gen_random_uuid(), 'a', 'dup')`,
    );

    await prisma.$executeRawUnsafe(
      `INSERT INTO garage (id, name, slug) VALUES (gen_random_uuid(), 'Ştefan', 'dup')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name`,
    );

    expect(await nameOf('dup')).toBe('Ștefan');
  });

  it('converts a multi-row INSERT ... SELECT', async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO garage (id, name, slug)
       SELECT gen_random_uuid(), 'Ţ' || n, 'bulk' || n FROM generate_series(1, 50) n`,
    );

    const [{ n }] = await select<{ n: number }>(
      `SELECT count(*)::int AS n FROM garage WHERE name LIKE 'Ț%'`,
    );
    expect(n).toBe(50);
  });

  it('converts an UPDATE that assigns a column to itself', async () => {
    await withoutTrigger(
      `INSERT INTO garage (id, name, slug) VALUES (gen_random_uuid(), 'Ţarc', 'self')`,
    );

    await prisma.$executeRawUnsafe(`UPDATE garage SET name = name`);

    expect(await nameOf('self')).toBe('Țarc');
  });

  it('leaves a remaining cedilla alone when another column is written', async () => {
    await withoutTrigger(
      `INSERT INTO garage (id, name, slug) VALUES (gen_random_uuid(), 'Ţarc', 'left')`,
    );

    await prisma.$executeRawUnsafe(
      `UPDATE garage SET slug = 'left-2' WHERE slug = 'left'`,
    );

    expect(await nameOf('left-2')).toBe('Ţarc');
  });
});

describe('what the conversion must not touch', () => {
  it('stores a decomposed cedilla as written', async () => {
    const decomposed = 'Şos Ţara';
    await prisma.garage.create({ data: { name: decomposed, slug: 'dec' } });

    const [row] = await select<{ name: string; bytes: number }>(
      `SELECT name, octet_length(name)::int AS bytes FROM garage WHERE slug = 'dec'`,
    );
    expect(row.name).toBe(decomposed);
    expect(row.bytes).toBe(Buffer.byteLength(decomposed));
  });

  it('leaves letters that only look like the cedilla ones', async () => {
    const lookalikes = 'Šš Ťť Ŝŝ Ŧŧ Çç Șț';
    await prisma.garage.create({ data: { name: lookalikes, slug: 'look' } });

    expect(await nameOf('look')).toBe(lookalikes);
  });

  it('converts around four-byte characters', async () => {
    await prisma.garage.create({
      data: { name: '🚗 Şos 🔧 Ţ', slug: 'emoji' },
    });

    expect(await nameOf('emoji')).toBe('🚗 Șos 🔧 Ț');
  });

  it('keeps the other columns of the row as written', async () => {
    await prisma.garage.create({
      data: {
        cityKey: 'iasi',
        cityName: 'Iaşi',
        name: 'Ş',
        slug: 'si-slug-ok',
      },
    });

    expect(
      await select(
        `SELECT slug, city_key AS "cityKey" FROM garage WHERE city_key = 'iasi'`,
      ),
    ).toEqual([{ cityKey: 'iasi', slug: 'si-slug-ok' }]);
  });
});

describe('the length limits with cedilla letters', () => {
  it('stores a 200-letter address of cedillas as 200 letters', async () => {
    await prisma.garage.create({
      data: { address: 'ş'.repeat(200), name: 'a', slug: 'len200' },
    });

    expect(
      await select(
        `SELECT address = repeat('ș', 200) AS same, char_length(address)::int AS n FROM garage`,
      ),
    ).toEqual([{ n: 200, same: true }]);
  });

  it('still refuses a 201-letter address of cedillas', async () => {
    await expect(
      prisma.garage.create({
        data: { address: 'ş'.repeat(201), name: 'a', slug: 'len201' },
      }),
    ).rejects.toThrow();
  });

  it('stores an 80-letter city of cedillas and refuses 81', async () => {
    await prisma.garage.create({
      data: { cityKey: 'x', cityName: 'Ţ'.repeat(80), name: 'a', slug: 'c80' },
    });
    expect(
      await select(`SELECT city_name = repeat('Ț', 80) AS same FROM garage`),
    ).toEqual([{ same: true }]);

    await expect(
      prisma.garage.create({
        data: {
          cityKey: 'y',
          cityName: 'Ţ'.repeat(81),
          name: 'a',
          slug: 'c81',
        },
      }),
    ).rejects.toThrow();
  });

  it('stores a seat address of cedillas in comma forms', async () => {
    await prisma.garage.create({
      data: { name: 'a', seatAddress: 'Ş'.repeat(200), slug: 'seat200' },
    });

    expect(
      await select(
        `SELECT seat_address = repeat('Ș', 200) AS same FROM garage`,
      ),
    ).toEqual([{ same: true }]);
  });
});

describe('f_unaccent', () => {
  it('answers null for null and empty for empty', async () => {
    expect(await fold(null)).toBeNull();
    expect(await fold('')).toBe('');
  });

  it('keeps case and every letter outside the Romanian ones', async () => {
    const other = 'ABC xyz ß ä ö ü ñ ç Š š Ť ť 🚗 \t-_';

    expect(await fold(other)).toBe(other);
  });

  it('composes the whole string, other letters included', async () => {
    expect(await fold('é')).toBe('é');
  });

  it('folds decomposed capitals and cedillas like the composed ones', async () => {
    expect(await fold('ȘŢĂÂÎ')).toBe('STAAI');
  });

  it('gives the same result when applied twice', async () => {
    const text = 'Ţară Şi Înţeles ȘȚĂÂÎ é';

    expect(await fold(await fold(text))).toBe(await fold(text));
  });

  it('folds the cedilla and the comma spelling of a name alike', async () => {
    expect(await fold('Ştefan Ţuţea')).toBe(await fold('Ștefan Țuțea'));
  });

  it('folds a megabyte of text', async () => {
    const [{ same }] = await select<{ same: boolean }>(
      `SELECT f_unaccent(repeat('Şţ', 500000)) = repeat('ST', 500000) AS same`,
    );
    expect(same).toBe(true);
  });

  it('is immutable and owned by no extension', async () => {
    expect(
      await select(
        `SELECT p.provolatile AS volatility,
                (SELECT count(*)::int FROM pg_depend d
                  WHERE d.objid = p.oid AND d.deptype = 'e') AS extensions,
                pg_get_functiondef(p.oid) ~* '(^|[^_])unaccent' AS uses_extension
           FROM pg_proc p WHERE p.oid = 'f_unaccent(text)'::regprocedure`,
      ),
    ).toEqual([{ extensions: 0, uses_extension: false, volatility: 'i' }]);
  });

  it('can be the expression of an index', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          'CREATE TEMP TABLE fold_probe (x text) ON COMMIT DROP',
        );
        await tx.$executeRawUnsafe(
          'CREATE INDEX ON fold_probe (f_unaccent(x))',
        );
        return 'built';
      }),
    ).resolves.toBe('built');
  });
});

describe('account_fold after it reads f_unaccent', () => {
  it('keeps its values: lower case and no Romanian marks', async () => {
    expect(await accountFold('Ţară ŞI Înţeles Ș É')).toBe(
      'tara si inteles s é',
    );
  });

  it('answers null for null', async () => {
    expect(await accountFold(null)).toBeNull();
  });

  it('equals lower(f_unaccent(x)) for the same text', async () => {
    const text = 'ȘŞȚŢĂÂÎ Cluj é';

    expect(await accountFold(text)).toBe(
      ((await fold(text)) ?? '').toLowerCase(),
    );
  });

  it('is still immutable and still behind a valid trigram index', async () => {
    expect(
      await select(
        `SELECT (SELECT provolatile FROM pg_proc WHERE oid = 'account_fold(text)'::regprocedure) AS volatility,
                (SELECT i.indisvalid FROM pg_index i
                   JOIN pg_class c ON c.oid = i.indexrelid
                  WHERE c.relname = 'account_name_fold_trgm_idx') AS valid,
                (SELECT indexdef ~ 'account_fold' FROM pg_indexes
                  WHERE indexname = 'account_name_fold_trgm_idx') AS on_fold`,
      ),
    ).toEqual([{ on_fold: true, valid: true, volatility: 'i' }]);
  });
});
