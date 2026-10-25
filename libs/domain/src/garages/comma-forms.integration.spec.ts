import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { serialDatabase } from '../auth/serial-db.testing';
import { databaseUrl, fixtures } from '../notifications/notifications.testing';

// @traces 1185-FR-001
// @traces 1185-FR-002
// @traces 1185-FR-004
// @traces 1185-FR-005

const { prisma } = fixtures();
serialDatabase(databaseUrl);

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE garage CASCADE');
});

afterAll(async () => {
  await prisma.$disconnect();
});

type Text = {
  address?: string | null;
  cityName?: string | null;
  name: string;
  seatAddress?: string | null;
};

// A garage holds an address or a seat address, never both
// (garage_address_or_seat): one fixture for each.
const cedillas = {
  address: 'Str. Şcolii 3, Iaşi',
  cityName: 'Iaşi',
  name: 'Service Ţuţuianu Ş.R.L.',
  seatAddress: null,
};
const commas = {
  address: 'Str. Școlii 3, Iași',
  cityName: 'Iași',
  name: 'Service Țuțuianu Ș.R.L.',
  seatAddress: null,
};
const mobileCedillas = {
  address: null,
  cityName: 'Bacău',
  name: 'Mecanic Ştefan',
  seatAddress: 'Bd. Ştefan cel Mare 12',
};
const mobileCommas = {
  address: null,
  cityName: 'Bacău',
  name: 'Mecanic Ștefan',
  seatAddress: 'Bd. Ștefan cel Mare 12',
};
const fields = ['name', 'address', 'seatAddress', 'cityName'] as const;
const cedilla = { ...cedillas, seatAddress: mobileCedillas.seatAddress };
const comma = { ...commas, seatAddress: mobileCommas.seatAddress };

const create = (slug: string, text: Partial<Text> = {}) =>
  prisma.garage.create({
    data: {
      address: text.address,
      cityKey: text.cityName == null ? undefined : 'iasi',
      cityName: text.cityName,
      name: text.name ?? slug,
      seatAddress: text.seatAddress,
      slug,
    },
  });

const stored = (id: string) =>
  prisma.garage.findUniqueOrThrow({
    select: { address: true, cityName: true, name: true, seatAddress: true },
    where: { id },
  });

describe('a garage written with cedilla letters', () => {
  it('is stored with the comma letters on insert', async () => {
    const garage = await create('insert', cedillas);

    expect(await stored(garage.id)).toEqual(commas);
  });

  it('stores a seat address with the comma letters on insert', async () => {
    const garage = await create('mobile', mobileCedillas);

    expect(await stored(garage.id)).toEqual(mobileCommas);
  });

  it.each(fields)('converts %s on update', async (field) => {
    const garage = await create('update', {
      cityName: 'Plain',
      name: 'Plain',
      [field === 'seatAddress' ? 'seatAddress' : 'address']: 'Plain',
    });

    await prisma.garage.update({
      data: { [field]: cedilla[field] },
      where: { id: garage.id },
    });

    expect((await stored(garage.id))[field]).toBe(comma[field]);
  });

  it('converts every cedilla letter, capitals and repeats included', async () => {
    const garage = await create('repeats', { name: 'ŞŢŞ şţş' });

    expect((await stored(garage.id)).name).toBe('ȘȚȘ șțș');
  });

  it('keeps a value without cedilla letters byte for byte', async () => {
    const plain = {
      address: 'Cluj-Napoca, Str. Memorandumului 1',
      cityName: 'Brașov',
      name: 'Brașov Ștefan Țară ăâî',
      seatAddress: null,
    };
    const garage = await create('plain', plain);

    const [row] = await prisma.$queryRawUnsafe<
      { name: string; bytes: number }[]
    >(
      'SELECT name, octet_length(name) AS bytes FROM garage WHERE id = $1::uuid',
      garage.id,
    );
    expect(await stored(garage.id)).toEqual(plain);
    expect(row.bytes).toBe(Buffer.byteLength(plain.name));
  });

  it('keeps a missing value missing', async () => {
    const garage = await create('empty', { name: 'Empty' });

    expect(await stored(garage.id)).toEqual({
      address: null,
      cityName: null,
      name: 'Empty',
      seatAddress: null,
    });
  });

  // address and seat_address refuse '' (garage_address_length,
  // garage_seat_address_length), so only these two can hold one.
  it('keeps an empty value empty', async () => {
    const garage = await create('blank', { cityName: '', name: '' });

    expect(await stored(garage.id)).toEqual({
      address: null,
      cityName: '',
      name: '',
      seatAddress: null,
    });
  });

  it('converts a value written as plain SQL', async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO garage (id, name, slug) VALUES (gen_random_uuid(), 'Ţarc', 'sql')`,
    );

    expect(
      await prisma.$queryRawUnsafe(
        `SELECT name FROM garage WHERE slug = 'sql'`,
      ),
    ).toEqual([{ name: 'Țarc' }]);
  });
});

describe('the one-off conversion of the stored garages', () => {
  const migration = readFileSync(
    join(
      __dirname,
      '..',
      '..',
      'prisma',
      'migrations',
      '20261024200000_garage_comma_forms',
      'migration.sql',
    ),
    'utf8',
  );
  const conversion = migration.match(/^UPDATE "garage"[\s\S]*?;$/m)?.[0];

  // Rows as they were before the trigger existed.
  const legacy = async (slug: string, text: Text) => {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE garage DISABLE TRIGGER garage_comma_forms',
    );
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO garage (id, name, slug, address, seat_address, city_key, city_name)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 'iasi', $5)`,
        text.name,
        slug,
        text.address,
        text.seatAddress,
        text.cityName,
      );
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE garage ENABLE TRIGGER garage_comma_forms',
      );
    }
  };
  const row = async (slug: string) => {
    const [found] = await prisma.$queryRawUnsafe<{ row: unknown }[]>(
      `SELECT row_to_json(g)::text AS row FROM garage g WHERE slug = $1`,
      slug,
    );
    return found.row;
  };

  it('is one statement in the migration', () => {
    expect(conversion).toBeDefined();
  });

  it('converts the cedilla letters of every stored garage', async () => {
    await legacy('legacy', cedillas);
    await legacy('mobile', mobileCedillas);
    expect(
      (await prisma.garage.findFirstOrThrow({ where: { slug: 'legacy' } }))
        .name,
    ).toBe(cedillas.name);

    await prisma.$executeRawUnsafe(conversion as string);

    const [garage, mobile] = await Promise.all(
      ['legacy', 'mobile'].map((slug) =>
        prisma.garage.findFirstOrThrow({ where: { slug } }),
      ),
    );
    expect(await stored(garage.id)).toEqual(commas);
    expect(await stored(mobile.id)).toEqual(mobileCommas);
  });

  it('touches nothing else of a converted garage', async () => {
    await legacy('legacy', cedillas);
    const before = JSON.parse(String(await row('legacy')));

    await prisma.$executeRawUnsafe(conversion as string);

    expect(JSON.parse(String(await row('legacy')))).toEqual({
      ...before,
      address: commas.address,
      city_name: commas.cityName,
      name: commas.name,
    });
  });

  it('changes only the rows that hold a cedilla, and none the second time', async () => {
    await legacy('hit', cedillas);
    await legacy('miss', commas);

    expect(await prisma.$executeRawUnsafe(conversion as string)).toBe(1);
    expect(await prisma.$executeRawUnsafe(conversion as string)).toBe(0);
  });

  it('leaves a garage without cedilla letters exactly as it was', async () => {
    await legacy('plain', commas);
    const before = await row('plain');

    const changed = await prisma.$executeRawUnsafe(conversion as string);

    expect(changed).toBe(0);
    expect(await row('plain')).toBe(before);
  });
});
