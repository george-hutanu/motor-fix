import type { MechanicsSection } from '@motor-fix/contracts';
import type { HttpException } from '@nestjs/common';

import { GarageMechanicsService } from './garage-mechanics.service';
import type { AuditEntry, AuditPort } from '../../audit/audit.port';
import type { Actor } from '../../auth/policy';
import type { Prisma } from '../../generated/prisma/client';

// Any read of the transaction fails the test: the guard runs before one.
const tx = new Proxy({} as Prisma.TransactionClient, {
  get: (_, key) => {
    throw new Error(`read ${String(key)}`);
  },
});

const refusalOf = (call: () => Promise<unknown>) =>
  call().then(
    () => undefined,
    (error: HttpException) => ({
      body: error.getResponse(),
      status: error.getStatus(),
    }),
  );

describe('GarageMechanicsService with a section that is not an object', () => {
  const service = new GarageMechanicsService(
    {} as AuditPort,
    {} as never,
    {} as never,
  );

  // @traces 208-FR-017
  it.each([null, 'Ion Marin', 7, [{ name: 'Ion' }]])(
    'answers 422 validation_failed for %j on the first and the next save',
    async (given) => {
      const section = given as unknown as MechanicsSection;
      for (const call of [
        () => service.saveCards(tx, 'garage', 'actor', section),
        () => service.saveAgain(tx, 'garage', 'actor', section),
      ]) {
        expect(await refusalOf(call)).toMatchObject({
          body: { code: 'validation_failed' },
          status: 422,
        });
      }
    },
  );
});

const GARAGE = '0f9c2a54-6a1e-4f43-9d2b-2f5a3c1d7e10';
const actorOf = (role: Actor['role'], garageId: string | null = GARAGE) =>
  ({ accountId: 'owner-account', garageId, role }) as Actor;

// Any read fails the test: the access check runs before one.
const untouched = new Proxy({} as Prisma.TransactionClient, {
  get: (_, key) => {
    throw new Error(`read ${String(key)}`);
  },
});

const card = (over: Record<string, unknown>) => ({
  accountId: null,
  brandIds: [],
  certifications: [],
  id: '00000000-0000-4000-8000-000000000001',
  invites: [],
  isOwner: false,
  name: 'Ion',
  onProfile: true,
  rating: null,
  reviewCount: 0,
  roleTitle: null,
  speciality: null,
  specialties: [],
  years: null,
  ...over,
});

// A client whose every model answers as an empty table, unless given: the
// service may read through it or through the transaction it opens.
function fakeDb(models: Record<string, Record<string, unknown>> = {}) {
  const empty = (method: string) =>
    jest.fn(async () => {
      if (method === 'findMany' || method === 'groupBy') return [];
      if (method === 'count') return 0;
      if (method.startsWith('find')) return null;
      return { count: 0 };
    });
  const tables = new Map<string, Record<string, unknown>>();
  const db: Record<string, unknown> = new Proxy(
    {},
    {
      get: (_, key) => {
        if (key === 'then') return undefined;
        if (key === '$transaction')
          return (work: (tx: unknown) => unknown) => work(db);
        if (key === '$queryRaw' || key === '$executeRaw')
          return jest.fn(async () => []);
        const name = String(key);
        if (!tables.has(name)) {
          const given = models[name] ?? {};
          tables.set(
            name,
            new Proxy(given, {
              get: (target, method) => {
                const m = String(method);
                if (!(m in target)) target[m] = empty(m);
                return target[m];
              },
            }),
          );
        }
        return tables.get(name);
      },
    },
  );
  return db as unknown as Prisma.TransactionClient & {
    [model: string]: Record<string, jest.Mock>;
  };
}

const listed = (
  rows: ReturnType<typeof card>[],
  brands: { id: string; name: string }[] = [],
) => {
  const prisma = fakeDb({
    garageBrand: {
      findMany: jest.fn(async () =>
        brands.map((brand) => ({
          brand,
          brandId: brand.id,
          garageId: GARAGE,
          stance: 'works_on',
        })),
      ),
    },
    garageFeature: { findUnique: jest.fn(async () => null) },
    mechanic: { findMany: jest.fn(async () => rows) },
  });
  return {
    list: (actor: Actor) =>
      new GarageMechanicsService(
        {} as AuditPort,
        {} as never,
        {} as never,
      ).list(prisma, actor, GARAGE),
  };
};

// @traces 055-FR-002
describe("GarageMechanicsService reading a garage's team", () => {
  it.each([
    ['receptionist', 403, 'forbidden'],
    ['mechanic', 403, 'forbidden'],
  ] as const)(
    'refuses the garage %s with %i %s before any read',
    async (role, status, code) => {
      const service = new GarageMechanicsService(
        {} as AuditPort,
        {} as never,
        {} as never,
      );

      expect(
        await refusalOf(() => service.list(untouched, actorOf(role), GARAGE)),
      ).toMatchObject({ body: { code }, status });
    },
  );

  it.each([
    ['a driver', actorOf('driver', null)],
    ['an admin', actorOf('admin', null)],
    ["another garage's owner", actorOf('garage', 'another-garage')],
  ])('answers %s 404 not_found before any read', async (_, actor) => {
    const service = new GarageMechanicsService(
      {} as AuditPort,
      {} as never,
      {} as never,
    );

    expect(
      await refusalOf(() => service.list(untouched, actor, GARAGE)),
    ).toMatchObject({
      body: { code: 'not_found' },
      status: 404,
    });
  });
});

// @traces 055-FR-001 056-FR-011
describe("GarageMechanicsService listing a garage's cards", () => {
  it('orders the cards by name as Romanian sorts them, equal names by id', async () => {
    const { list } = listed([
      card({ id: '00000000-0000-4000-8000-000000000004', name: 'Tudor' }),
      card({ id: '00000000-0000-4000-8000-000000000003', name: 'Ștefan' }),
      card({ id: '00000000-0000-4000-8000-000000000002', name: 'stan' }),
      card({ id: '00000000-0000-4000-8000-000000000009', name: 'Ion' }),
      card({ id: '00000000-0000-4000-8000-000000000001', name: 'ion' }),
    ]);

    const { items } = await list(actorOf('garage'));

    expect(items.map((item) => [item.name, item.id.slice(-1)])).toEqual([
      ['ion', '1'],
      ['Ion', '9'],
      ['stan', '2'],
      ['Ștefan', '3'],
      ['Tudor', '4'],
    ]);
  });

  it('answers each card with its account, its speciality or null, and its figures', async () => {
    const { list } = listed([
      card({
        accountId: 'mechanic-account',
        name: 'Andrei',
        rating: { toFixed: (digits: number) => (5).toFixed(digits) },
        reviewCount: 58,
        speciality: 'Frâne',
      }),
      card({
        id: '00000000-0000-4000-8000-000000000002',
        name: 'Costel',
        onProfile: false,
      }),
    ]);

    const fresh = {
      brandIds: [],
      certifications: [],
      futureBookings: 0,
      invite: null,
      isOwner: false,
      roleTitle: null,
      specialties: [],
      years: null,
    };
    expect(await list(actorOf('garage'))).toEqual({
      brands: [],
      items: [
        {
          ...fresh,
          hasAccount: true,
          id: '00000000-0000-4000-8000-000000000001',
          name: 'Andrei',
          onProfile: true,
          rating: '5.0',
          reviewCount: 58,
          speciality: 'Frâne',
        },
        {
          ...fresh,
          hasAccount: false,
          id: '00000000-0000-4000-8000-000000000002',
          name: 'Costel',
          onProfile: false,
          rating: null,
          reviewCount: 0,
          speciality: null,
        },
      ],
    });
  });
});

// @traces 056-FR-011
describe("GarageMechanicsService listing a garage's cards with the owner's row", () => {
  it("puts the owner's row first, then the rest by name", async () => {
    const { list } = listed([
      card({ id: '00000000-0000-4000-8000-000000000002', name: 'Ana' }),
      card({
        accountId: 'owner-account',
        id: '00000000-0000-4000-8000-000000000003',
        isOwner: true,
        name: 'Zoe Marin',
      }),
      card({ id: '00000000-0000-4000-8000-000000000001', name: 'Bogdan' }),
    ]);

    const { items } = await list(actorOf('garage'));

    expect(
      (items as unknown as { isOwner: boolean; name: string }[]).map((item) => [
        item.name,
        item.isOwner,
      ]),
    ).toEqual([
      ['Zoe Marin', true],
      ['Ana', false],
      ['Bogdan', false],
    ]);
  });

  it('answers the card fields as stored, a full card at every bound', async () => {
    const specialties = Array.from({ length: 6 }, (_, i) =>
      `${i}`.padEnd(40, 'ș'),
    );
    const certifications = Array.from({ length: 10 }, (_, i) =>
      `${i}`.padEnd(80, 'ț'),
    );
    const brandIds = ['00000000-0000-4000-8000-0000000000b1'];
    const { list } = listed([
      card({
        brandIds,
        certifications,
        roleTitle: 'Ș'.repeat(40),
        speciality: specialties.join(', '),
        specialties,
        years: 60,
      }),
    ]);

    const [item] = (await list(actorOf('garage'))).items;

    expect(item).toMatchObject({
      brandIds,
      certifications,
      futureBookings: 0,
      isOwner: false,
      roleTitle: 'Ș'.repeat(40),
      speciality: specialties.join(', '),
      specialties,
      years: 60,
    });
    expect(item.speciality).toHaveLength(250);
  });

  it("answers the garage's works-on brands by name, A to Z", async () => {
    const { list } = listed(
      [],
      [
        { id: '00000000-0000-4000-8000-0000000000b2', name: 'Škoda' },
        { id: '00000000-0000-4000-8000-0000000000b1', name: 'Audi' },
        { id: '00000000-0000-4000-8000-0000000000b3', name: 'Dacia' },
      ],
    );

    const answer = (await list(actorOf('garage'))) as unknown as {
      brands: { id: string; name: string }[];
    };

    expect(answer.brands.map((brand) => brand.name)).toEqual([
      'Audi',
      'Dacia',
      'Škoda',
    ]);
    expect(answer.brands[0]).toEqual({
      id: '00000000-0000-4000-8000-0000000000b1',
      name: 'Audi',
    });
  });
});

// The writes this feature adds, typed loosely until the service has them.
type Writes = {
  add(
    db: Prisma.TransactionClient,
    actor: Actor,
    garageId: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  edit(
    db: Prisma.TransactionClient,
    actor: Actor,
    garageId: string,
    mechanicId: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
};

const ELENA = '00000000-0000-4000-8000-00000000e1e1';

function writer(stored: Record<string, unknown> = card({ id: ELENA })) {
  const audit = {
    record: jest.fn(async () => undefined),
    recordChanges: jest.fn(async () => undefined),
    recordMany: jest.fn(async () => undefined),
  };
  const events = { record: jest.fn(async () => undefined) };
  const notifications = { notify: jest.fn(async () => undefined) };
  const create = jest.fn(async ({ data }: { data: Record<string, unknown> }) =>
    card({ ...data, id: ELENA }),
  );
  let current = stored;
  const update = jest.fn(
    async ({ data }: { data: Record<string, unknown> }) => {
      current = { ...current, ...data };
      return { count: 1 };
    },
  );
  const found = jest.fn(async () => current);
  const db = fakeDb({
    garageFeature: { findUnique: jest.fn(async () => null) },
    mechanic: {
      create,
      findFirst: found,
      findFirstOrThrow: found,
      findUnique: found,
      findUniqueOrThrow: found,
      updateMany: update,
    },
  });
  const Service = GarageMechanicsService as unknown as new (
    ...deps: unknown[]
  ) => Writes;
  const service = new Service(audit, events, notifications);
  return {
    add: (body: Record<string, unknown>) =>
      service.add(db, actorOf('garage'), GARAGE, body),
    audit,
    create,
    edit: (body: Record<string, unknown>) =>
      service.edit(db, actorOf('garage'), GARAGE, ELENA, body),
    events,
    update,
  };
}

const fieldsRefused = async (call: () => Promise<unknown>) => {
  const refused = await refusalOf(call);
  expect(refused).toMatchObject({
    body: { code: 'validation_failed' },
    status: 422,
  });
  const body = refused?.body as
    | { errors?: { code: string; field: string }[] }
    | undefined;
  return body?.errors ?? [];
};

// Every update entry the audit was given, one per field.
function updatesOf(audit: ReturnType<typeof writer>['audit']) {
  const entries: { field: string; newValue: unknown; oldValue: unknown }[] = [];
  for (const [, , before, after] of audit.recordChanges.mock
    .calls as unknown as [
    unknown,
    unknown,
    Record<string, unknown>,
    Record<string, unknown>,
  ][]) {
    for (const field of Object.keys(after)) {
      if (JSON.stringify(before[field]) === JSON.stringify(after[field]))
        continue;
      entries.push({ field, newValue: after[field], oldValue: before[field] });
    }
  }
  const single = audit.record.mock.calls.map(
    (call) => (call as unknown[])[1],
  ) as Partial<AuditEntry>[];
  const many = audit.recordMany.mock.calls.flatMap(
    (call) => (call as unknown[])[1] as Partial<AuditEntry>[],
  );
  for (const entry of [...single, ...many]) {
    if (entry.action !== 'update') continue;
    entries.push({
      field: entry.field as string,
      newValue: entry.newValue,
      oldValue: entry.oldValue,
    });
  }
  return entries;
}

// @traces 056-FR-001 056-FR-002
describe('GarageMechanicsService adding a card', () => {
  it('trims the name and stores the specialties joined as the speciality line', async () => {
    const { add, create } = writer();

    await add({
      name: '  Elena Stan ',
      specialties: ['Frâne', 'Diagnoză'],
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data).toMatchObject({
      garageId: GARAGE,
      name: 'Elena Stan',
      speciality: 'Frâne, Diagnoză',
      specialties: ['Frâne', 'Diagnoză'],
    });
  });

  it('stores no speciality line for a card with no specialties', async () => {
    const { add, create } = writer();

    await add({ name: 'Elena Stan' });

    expect(create.mock.calls[0][0].data).toMatchObject({ speciality: null });
  });

  it('answers the new card as the list shows it', async () => {
    const { add } = writer();

    expect(
      await add({ name: 'Elena Stan', roleTitle: 'Șef atelier', years: 12 }),
    ).toMatchObject({
      futureBookings: 0,
      hasAccount: false,
      id: ELENA,
      isOwner: false,
      name: 'Elena Stan',
      onProfile: false,
      roleTitle: 'Șef atelier',
      years: 12,
    });
  });

  it.each([
    ['empty', '   ', 'required'],
    ['of 81 characters', 'E'.repeat(81), 'too_long'],
  ])('refuses a name %s, writing nothing', async (_, name, code) => {
    const { add, create } = writer();

    expect(await fieldsRefused(() => add({ name }))).toContainEqual({
      code,
      field: 'name',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a name of one character and keeps one of two and of 80', async () => {
    const { add } = writer();

    expect(await fieldsRefused(() => add({ name: ' E ' }))).toContainEqual(
      expect.objectContaining({ field: 'name' }),
    );
    await expect(add({ name: 'El' })).resolves.toBeDefined();
    await expect(add({ name: 'E'.repeat(80) })).resolves.toBeDefined();
  });

  it('keeps a role title of 40 characters and refuses one of 41', async () => {
    const { add } = writer();

    await expect(
      add({ name: 'Elena Stan', roleTitle: 'Ș'.repeat(40) }),
    ).resolves.toBeDefined();
    expect(
      await fieldsRefused(() =>
        add({ name: 'Elena Stan', roleTitle: 'Ș'.repeat(41) }),
      ),
    ).toContainEqual({ code: 'too_long', field: 'roleTitle' });
  });

  it('keeps six specialties of 40 characters and refuses a seventh or a longer one', async () => {
    const { add } = writer();
    const six = Array.from({ length: 6 }, (_, i) => `${i}`.padEnd(40, 'ș'));

    await expect(
      add({ name: 'Elena Stan', specialties: six }),
    ).resolves.toBeDefined();
    expect(
      await fieldsRefused(() =>
        add({ name: 'Elena Stan', specialties: [...six, 'Motor'] }),
      ),
    ).toContainEqual({ code: 'too_many', field: 'specialties' });
    expect(
      await fieldsRefused(() =>
        add({ name: 'Elena Stan', specialties: ['ș'.repeat(41)] }),
      ),
    ).toContainEqual({ code: 'too_long', field: 'specialties' });
  });

  it('keeps ten certifications of 80 characters and refuses an eleventh or a longer one', async () => {
    const { add } = writer();
    const ten = Array.from({ length: 10 }, (_, i) => `${i}`.padEnd(80, 'ț'));

    await expect(
      add({ certifications: ten, name: 'Elena Stan' }),
    ).resolves.toBeDefined();
    expect(
      await fieldsRefused(() =>
        add({ certifications: [...ten, 'ISO'], name: 'Elena Stan' }),
      ),
    ).toContainEqual({ code: 'too_many', field: 'certifications' });
    expect(
      await fieldsRefused(() =>
        add({ certifications: ['ț'.repeat(81)], name: 'Elena Stan' }),
      ),
    ).toContainEqual({ code: 'too_long', field: 'certifications' });
  });

  it.each([
    [61, 'out_of_range'],
    [-1, 'out_of_range'],
    [1.5, 'invalid'],
  ])('refuses %p years as %s', async (years, code) => {
    const { add, create } = writer();

    expect(
      await fieldsRefused(() => add({ name: 'Elena Stan', years })),
    ).toContainEqual({ code, field: 'years' });
    expect(create).not.toHaveBeenCalled();
  });

  it('keeps 0 and 60 years', async () => {
    const { add } = writer();

    await expect(add({ name: 'Elena Stan', years: 0 })).resolves.toBeDefined();
    await expect(add({ name: 'Elena Stan', years: 60 })).resolves.toBeDefined();
  });

  it('adds two cards with one name', async () => {
    const { add, create } = writer();

    await add({ name: 'Elena Stan' });
    await add({ name: 'Elena Stan' });

    expect(create).toHaveBeenCalledTimes(2);
  });
});

// @traces 056-FR-002 056-FR-005
describe('GarageMechanicsService editing a card', () => {
  const stored = () =>
    card({
      certifications: ['RAR'],
      id: ELENA,
      name: 'Elena Stan',
      roleTitle: 'Șef atelier',
      speciality: 'Frâne',
      specialties: ['Frâne'],
      years: 12,
    });

  it('leaves every field the patch omits as it is', async () => {
    const { audit, edit } = writer(stored());

    const answer = await edit({ roleTitle: 'Mecanic' });

    expect(answer).toMatchObject({
      certifications: ['RAR'],
      name: 'Elena Stan',
      roleTitle: 'Mecanic',
      speciality: 'Frâne',
      specialties: ['Frâne'],
      years: 12,
    });
    expect(updatesOf(audit)).toEqual([
      { field: 'roleTitle', newValue: 'Mecanic', oldValue: 'Șef atelier' },
    ]);
  });

  it('clears the role title and the years with null', async () => {
    const { edit, update } = writer(stored());

    const answer = await edit({ roleTitle: null, years: null });

    expect(update.mock.calls[0][0].data).toMatchObject({
      roleTitle: null,
      years: null,
    });
    expect(answer).toMatchObject({ roleTitle: null, years: null });
  });

  it('clears an array with [], and the speciality line with it', async () => {
    const { edit, update } = writer(stored());

    const answer = await edit({ certifications: [], specialties: [] });

    expect(update.mock.calls[0][0].data).toMatchObject({
      certifications: [],
      speciality: null,
      specialties: [],
    });
    expect(answer).toMatchObject({
      certifications: [],
      speciality: null,
      specialties: [],
    });
  });

  it.each([null, '', '  '])(
    'never clears the name, refusing %j as required',
    async (name) => {
      const { edit, update } = writer(stored());

      expect(await fieldsRefused(() => edit({ name }))).toContainEqual({
        code: 'required',
        field: 'name',
      });
      expect(update).not.toHaveBeenCalled();
    },
  );

  it('writes nothing for an empty patch and answers the card', async () => {
    const { audit, edit, events, update } = writer(stored());

    const answer = await edit({});

    expect(update).not.toHaveBeenCalled();
    expect(updatesOf(audit)).toEqual([]);
    expect(audit.record).not.toHaveBeenCalled();
    expect(events.record).not.toHaveBeenCalled();
    expect(answer).toMatchObject({ id: ELENA, name: 'Elena Stan' });
  });

  it('writes nothing for a patch that repeats the stored values', async () => {
    const { audit, events, edit } = writer(stored());

    await edit({ specialties: ['Frâne'], years: 12 });

    expect(updatesOf(audit)).toEqual([]);
    expect(events.record).not.toHaveBeenCalled();
  });

  it('derives the speciality line again from the new specialties', async () => {
    const { edit, update } = writer(stored());

    await edit({ specialties: ['Frâne', 'Motor'] });

    expect(update.mock.calls[0][0].data).toMatchObject({
      speciality: 'Frâne, Motor',
      specialties: ['Frâne', 'Motor'],
    });
  });

  it('records an array change with its entries joined, and no entry for the speciality line', async () => {
    const { audit, edit } = writer(stored());

    await edit({
      certifications: ['RAR', 'Bosch'],
      specialties: ['Frâne', 'Motor'],
    });

    const entries = updatesOf(audit);
    expect(entries).toEqual(
      expect.arrayContaining([
        { field: 'specialties', newValue: 'Frâne, Motor', oldValue: 'Frâne' },
        {
          field: 'certifications',
          newValue: 'RAR, Bosch',
          oldValue: 'RAR',
        },
      ]),
    );
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.field)).not.toContain('speciality');
  });

  it('judges the limits on edit as on add', async () => {
    const { edit, update } = writer(stored());

    expect(
      await fieldsRefused(() => edit({ roleTitle: 'Ș'.repeat(41), years: 61 })),
    ).toEqual(
      expect.arrayContaining([
        { code: 'too_long', field: 'roleTitle' },
        { code: 'out_of_range', field: 'years' },
      ]),
    );
    expect(update).not.toHaveBeenCalled();
  });
});
