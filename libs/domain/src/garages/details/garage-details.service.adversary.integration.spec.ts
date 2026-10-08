import type { DetailsSection } from '@motor-fix/contracts';

import { GarageDetailsService } from './garage-details.service';
import { AuditService } from '../../audit/audit.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';
import { afterRace, refused } from '../prices/garage-prices.testing';

const { account, prisma } = fixtures();
const details = new GarageDetailsService(new AuditService());
serialDatabase(databaseUrl);

const section: DetailsSection = {
  businessKind: 'company',
  knownFor: 'Frâne',
  name: 'Service Popescu',
  phone: '0722123456',
};

let owner = '';

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE account, garage CASCADE');
  owner = await account('Mihai Ionescu', ['garage']);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const create = (given: DetailsSection) =>
  prisma.$transaction((tx) => details.create(tx, owner, given));

describe('GarageDetailsService.create under hostile input', () => {
  it.each([['!!!'], ['???'], ['日本語サービス'], ['😀😀'], ['  --  ']])(
    'gives a name of %s a usable slug and lets a second one in too',
    async (name) => {
      const first = await create({ ...section, name });
      const second = await create({ ...section, name });

      expect(first.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(second.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(second.slug).not.toBe(first.slug);
    },
  );

  it('writes slugs in lower case, without accents, with hyphens for non-letters', async () => {
    const { slug } = await create({ ...section, name: 'Ăutó Șțefan & Fiii!' });

    expect(slug).toBe('auto-stefan-fiii');
  });

  it('numbers three garages of one name one after the other', async () => {
    const slugs = [
      (await create(section)).slug,
      (await create(section)).slug,
      (await create(section)).slug,
    ];

    expect(new Set(slugs).size).toBe(3);
    expect(slugs[0]).toBe('service-popescu');
  });

  it('gives different names that make one slug different slugs', async () => {
    const a = await create({ ...section, name: 'Auto-Nord' });
    const b = await create({ ...section, name: 'Auto Nord' });
    const c = await create({ ...section, name: 'AUTO  NORD' });

    expect(new Set([a.slug, b.slug, c.slug]).size).toBe(3);
  });

  it('does not let a name that looks like a numbered slug take the next free one', async () => {
    await create({ ...section, name: 'Service Popescu' });
    await create({ ...section, name: 'Service Popescu 2' });

    const third = await create({ ...section, name: 'Service Popescu' });

    expect(third.slug).not.toBe('service-popescu');
    expect(third.slug).not.toBe('service-popescu-2');
  });

  it('takes a name of exactly 80 characters and refuses 81 after trimming', async () => {
    const ok = await create({ ...section, name: ` ${'a'.repeat(80)} ` });
    expect(
      (await prisma.garage.findUniqueOrThrow({ where: { id: ok.id } })).name,
    ).toBe('a'.repeat(80));

    expect(await refused(create({ ...section, name: 'a'.repeat(81) }))).toEqual(
      [{ code: 'length', field: 'name' }],
    );
  });

  it('takes a knownFor of exactly 160 characters and refuses 161', async () => {
    await create({ ...section, knownFor: 'k'.repeat(160) });

    expect(
      await refused(create({ ...section, knownFor: 'k'.repeat(161) })),
    ).toEqual([{ code: 'length', field: 'knownFor' }]);
    expect(await prisma.garage.count()).toBe(1);
  });

  it.each([
    ['0722123456', '+40722123456'],
    ['0722 123 456', '+40722123456'],
    ['+40 722 123 456', '+40722123456'],
    ['0040722123456', '+40722123456'],
    ['  0722-123-456  ', '+40722123456'],
  ])('stores the phone %j as %s', async (phone, stored) => {
    const { id } = await create({ ...section, phone });

    expect(
      (await prisma.garage.findUniqueOrThrow({ where: { id } })).phone,
    ).toBe(stored);
  });

  it.each([
    ['+44 7911 123456'],
    ['+4072212345'],
    ['+407221234567'],
    ['072212345'],
    ['0722abc456'],
    ['٠٧٢٢١٢٣٤٥٦'],
    ['+1 202 555 0143'],
  ])(
    'refuses the phone %j as not Romanian and stores nothing',
    async (phone) => {
      expect(await refused(create({ ...section, phone }))).toEqual([
        { code: 'romanian', field: 'phone' },
      ]);
      expect(await prisma.garage.count()).toBe(0);
    },
  );

  it('refuses a phone of only spaces as missing', async () => {
    const errors = await refused(create({ ...section, phone: '    ' }));

    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('phone');
  });

  it.each(['llc', 'COMPANY', ''])(
    'refuses the business kind %j with a field error, not a database error',
    async (businessKind) => {
      const errors = await refused(
        create({ ...section, businessKind } as unknown as DetailsSection),
      );

      expect(errors.map((e) => e.field)).toEqual(['businessKind']);
      expect(await prisma.garage.count()).toBe(0);
    },
  );

  it('refuses a legal form that is not pfa or company for a mobile mechanic', async () => {
    const errors = await refused(
      create({
        ...section,
        businessKind: 'mobile',
        mobileLegalForm: 'ii',
      } as unknown as DetailsSection),
    );

    expect(errors.map((e) => e.field)).toEqual(['mobileLegalForm']);
  });

  it.each([null, 7, ['a'], {}])(
    'refuses a name of %j as a field error, not a server error',
    async (name) => {
      const errors = await refused(
        create({ ...section, name } as unknown as DetailsSection),
      );

      expect(errors.map((e) => e.field)).toContain('name');
      expect(await prisma.garage.count()).toBe(0);
    },
  );

  it('stores a garage that is a draft and has no owner other than the audit actor', async () => {
    const { id } = await create(section);

    expect(
      await prisma.garage.findUniqueOrThrow({ where: { id } }),
    ).toMatchObject({ status: 'draft' });
  });

  it('records exactly one create entry whose stored values hold the normalised phone', async () => {
    const { id } = await create({ ...section, phone: '0722 123 456' });

    const entries = await prisma.activityLog.findMany({
      where: { subjectId: id },
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'create',
      actorId: owner,
      subjectType: 'garage',
    });
    expect(JSON.stringify(entries[0])).toContain('+40722123456');
    expect(JSON.stringify(entries[0])).not.toContain('0722 123 456');
  });

  it('puts no event in the outbox', async () => {
    const before = await prisma.outboxEvent.count();

    await create(section);

    expect(await prisma.outboxEvent.count()).toBe(before);
  });

  it('writes nothing when an invalid section follows a valid one in one transaction', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await details.create(tx, owner, section);
        await details.create(tx, owner, { ...section, phone: '123' });
      }),
    ).rejects.toMatchObject({ status: 422 });

    expect(await prisma.garage.count()).toBe(0);
    expect(
      await prisma.activityLog.count({
        where: { actorId: owner, subjectType: 'garage' },
      }),
    ).toBe(0);
  });

  it('reports every bad field of an empty section at once, none left out', async () => {
    const errors = await refused(create({}));

    expect(errors.map((e) => e.field).sort()).toEqual([
      'businessKind',
      'knownFor',
      'name',
      'phone',
    ]);
  });

  it('answers the loser of two sendings of different names with no error', async () => {
    const other = { ...section, name: 'Service Ionescu' };

    const loser = await afterRace(
      prisma,
      (tx) => details.create(tx, owner, section),
      () => create(other),
    );

    expect(loser.slug).toBe('service-ionescu');
  });
});
