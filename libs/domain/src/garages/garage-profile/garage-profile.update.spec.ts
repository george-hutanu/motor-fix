import { GarageProfileUpdate } from './garage-profile.update';
import type { Actor } from '../../auth/policy';
import { writeGarageHours } from '../garage-hours';

jest.mock('../garage-hours', () => ({
  ...jest.requireActual('../garage-hours'),
  writeGarageHours: jest.fn(),
}));

// @traces 1246-FR-001 1246-FR-002 1246-FR-003 1246-FR-004 1246-FR-005
// @traces 1246-FR-006 1246-FR-007 1246-FR-008

const GARAGE = '7b0c9a52-2f7e-4d55-9a0f-0d6c1a0e5c11';
const OTHER = '0f6a3c1e-1d7b-4b8e-8f5a-2c9d4e6b7a10';
const PHONE = '+40722123456';
const WEEK = {
  fri: [['08:00', '17:00']],
  mon: [['08:00', '17:00']],
  sat: [],
  sun: [],
  thu: [['08:00', '17:00']],
  tue: [['08:00', '17:00']],
  wed: [['08:00', '17:00']],
};
const SATURDAY = { ...WEEK, sat: [['09:00', '13:00']] };

const actor = (role: Actor['role'], garageId: string | null = GARAGE) =>
  ({
    accountId: 'a-1',
    garageId,
    permissions: {},
    role,
    roles: [role],
  }) as unknown as Actor;
const owner = actor('garage');

const ROW = {
  business_kind: 'company',
  closed_days: [] as { day: string; note: string | null }[],
  courtesy_car_paid: true,
  courtesy_car_price_per_day_bani: 15000,
  facilities: ['courtesy_car', 'waiting_area'],
  facilities_note: 'Cafea',
  hours: WEEK as unknown,
  known_for: 'Dacia',
  name: 'Service Auto Nord',
  payment_card: false,
  payment_cash: true,
  payment_transfer: true,
  phone: PHONE as string | null,
  profile_version: 7,
  service_radius_km: null as number | null,
  slug: 'service-auto-nord',
  status: 'approved',
};
type Row = typeof ROW;

const write = jest.mocked(writeGarageHours);

function harness(row: Partial<Row> = {}, { updated = 1 } = {}) {
  const locked = { ...ROW, ...row };
  // What the hours write leaves: the sent week and the closed days it kept.
  const state = { closed_days: locked.closed_days, hours: locked.hours };
  write.mockReset();
  write.mockImplementation(async (_tx, _id, section) => {
    state.hours = section['hours'];
    state.closed_days = (
      (section['closedDays'] ?? []) as { day: string; note?: string }[]
    )
      .filter((c) => c.day !== '2026-12-25')
      .map((c) => ({ day: c.day, note: c.note?.trim() || null }));
    return [];
  });
  let reads = 0;
  const tx = {
    $queryRaw: jest.fn(async () => (reads++ === 0 ? [locked] : [{ ...state }])),
    garage: { updateMany: jest.fn(async () => ({ count: updated })) },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const audit = { recordChanges: jest.fn(async () => undefined) };
  const events = { record: jest.fn(async () => undefined) };
  const answer = jest.fn(async () => ({ name: 'answer', version: '8' }));
  const update = new GarageProfileUpdate(
    prisma as never,
    audit as never,
    events as never,
    { answer } as never,
  );
  const save = (body: unknown, as: Actor = owner) =>
    update.save(as, GARAGE, body);
  return { answer, audit, events, prisma, save, tx };
}

type Refused = {
  getStatus(): number;
  getResponse(): { code: string; errors?: { code: string; field: string }[] };
};
const refused = async (promise: Promise<unknown>) => {
  const error = (await promise.then(
    () => {
      throw new Error('not refused');
    },
    (e: unknown) => e,
  )) as Refused;
  return { status: error.getStatus(), ...error.getResponse() };
};
const fieldsOf = (r: { errors?: { field: string }[] }) =>
  (r.errors ?? []).map((e) => e.field);

const nothingWritten = (h: ReturnType<typeof harness>) => {
  expect(h.tx.garage.updateMany).not.toHaveBeenCalled();
  expect(h.audit.recordChanges).not.toHaveBeenCalled();
  expect(h.events.record).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
};

describe("the owner's profile save: who may save", () => {
  it("answers 404 to another garage's owner before opening a transaction", async () => {
    const h = harness();

    const r = await refused(
      h.save({ name: 'Nou', version: '7' }, actor('garage', OTHER)),
    );

    expect(r.status).toBe(404);
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  // @traces 1369-FR-004
  it.each(['receptionist', 'mechanic'] as const)(
    'answers 403 forbidden to the %s, even with a body that breaks every rule',
    async (role) => {
      const h = harness({ status: 'suspended' });

      const r = await refused(
        h.save({ address: 'x', name: 'N', version: '0' }, actor(role)),
      );

      expect(r).toMatchObject({ code: 'forbidden', status: 403 });
      expect(h.prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it('answers 410 gone for a suspended garage before the verification fields and the limits', async () => {
    const h = harness({ status: 'suspended' });

    const r = await refused(h.save({ address: 'x', name: 'N', version: '0' }));

    expect(r).toMatchObject({ code: 'gone', status: 410 });
    nothingWritten(h);
  });

  it('answers 404 for a garage not yet approved', async () => {
    const h = harness({ status: 'draft' });

    const r = await refused(h.save({ address: 'x', version: '7' }));

    expect(r).toMatchObject({ code: 'not_found', status: 404 });
    nothingWritten(h);
  });

  it('answers 404 when the garage row is gone', async () => {
    const h = harness();
    h.tx.$queryRaw.mockResolvedValueOnce([] as never);

    const r = await refused(h.save({ name: 'Nou', version: '7' }));

    expect(r.status).toBe(404);
    nothingWritten(h);
  });
});

describe("the owner's profile save: what it refuses, in order", () => {
  it.each([
    'address',
    'companyName',
    'cui',
    'mobileLegalForm',
    'seatAddress',
    'rarActivities',
    'proposedJobs',
  ])('answers 422 needs_verification naming %s', async (field) => {
    const h = harness();

    const r = await refused(h.save({ [field]: 'x', version: '7' }));

    expect(r).toMatchObject({ code: 'needs_verification', status: 422 });
    expect(fieldsOf(r)).toEqual([field]);
    nothingWritten(h);
  });

  it('names every verification field sent, before a broken limit and a stale stamp', async () => {
    const h = harness();

    const r = await refused(
      h.save({ address: 'x', cui: '1', name: 'N', version: '1' }),
    );

    expect(r.status).toBe(422);
    expect(fieldsOf(r).sort()).toEqual(['address', 'cui']);
  });

  it.each([
    ['a name of one character', { name: 'N' }, 'name'],
    ['a name of 81 characters', { name: 'N'.repeat(81) }, 'name'],
    ['a name of spaces', { name: '   ' }, 'name'],
    ['a null name', { name: null }, 'name'],
    ['a null description', { description: null }, 'description'],
    ['a null phone', { phone: null }, 'phone'],
    ['null hours', { hours: null }, 'hours'],
    ['null closed days', { closedDays: null }, 'closedDays'],
    [
      'a description of 1,001 characters',
      { description: 'd'.repeat(1001) },
      'description',
    ],
    ['a phone the normaliser refuses', { phone: 'abc' }, 'phone'],
    ['a phone outside Romania', { phone: '+4930123456' }, 'phone'],
    ['bad hours', { hours: { ...WEEK, sun: undefined } }, 'hours'],
    ['bad closed days', { closedDays: [{ day: '2026-13-01' }] }, 'closedDays'],
    ['a field it does not know', { color: 'red' }, 'color'],
  ])(
    'answers 400 validation_failed to %s, naming it',
    async (_, body, field) => {
      const h = harness();

      const r = await refused(h.save({ version: '7', ...body }));

      expect(r).toMatchObject({ code: 'validation_failed', status: 400 });
      expect(fieldsOf(r)).toEqual([field]);
      nothingWritten(h);
    },
  );

  it.each([[4], [101], [30.5], ['30']])(
    'answers 400 to a radius of %p for a mobile mechanic',
    async (radius) => {
      const h = harness({ business_kind: 'mobile', service_radius_km: 20 });

      const r = await refused(
        h.save({ serviceRadiusKm: radius, version: '7' }),
      );

      expect(r.status).toBe(400);
      expect(fieldsOf(r)).toEqual(['serviceRadiusKm']);
      nothingWritten(h);
    },
  );

  it('answers 400 radius_not_applicable to a radius for a workshop', async () => {
    const h = harness();

    const r = await refused(h.save({ serviceRadiusKm: 30, version: '7' }));

    expect(r).toMatchObject({
      code: 'validation_failed',
      errors: [{ code: 'radius_not_applicable', field: 'serviceRadiusKm' }],
      status: 400,
    });
    nothingWritten(h);
  });

  it.each([
    ['a body with no group', { version: '7' }],
    ['a body that is not an object', ['name']],
    ['no stamp', { name: 'Service Auto Sud' }],
  ])('answers 400 to %s', async (_, body) => {
    const h = harness();

    const r = await refused(h.save(body));

    expect(r).toMatchObject({ code: 'validation_failed', status: 400 });
    nothingWritten(h);
  });

  it('answers 400 before 409 when both apply', async () => {
    const h = harness();

    const r = await refused(h.save({ name: 'N', version: '3' }));

    expect(r.status).toBe(400);
  });

  it('answers 409 profile_changed to a stale stamp and writes nothing', async () => {
    const h = harness();

    const r = await refused(h.save({ name: 'Service Auto Sud', version: '6' }));

    expect(r).toMatchObject({ code: 'profile_changed', status: 409 });
    expect(r.errors).toBeUndefined();
    nothingWritten(h);
  });

  it('answers 409 when the conditional update finds the stamp moved', async () => {
    const h = harness({}, { updated: 0 });

    const r = await refused(h.save({ name: 'Service Auto Sud', version: '7' }));

    expect(r).toMatchObject({ code: 'profile_changed', status: 409 });
    expect(h.audit.recordChanges).not.toHaveBeenCalled();
    expect(h.events.record).not.toHaveBeenCalled();
  });
});

describe("the owner's profile save: what it writes", () => {
  it('writes the trimmed name on the stamp it read, bumps it, never the slug, and answers the fresh profile', async () => {
    const h = harness();

    const answer = await h.save({ name: '  Service Auto Sud ', version: '7' });

    expect(h.tx.garage.updateMany).toHaveBeenCalledWith({
      data: { name: 'Service Auto Sud', profileVersion: { increment: 1 } },
      where: { id: GARAGE, profileVersion: 7 },
    });
    expect(h.answer).toHaveBeenCalledWith(GARAGE, true);
    expect(answer).toEqual({ name: 'answer', version: '8' });
  });

  it('records one audit entry per changed field, as the owner, on the garage', async () => {
    const h = harness();

    await h.save({
      description: ' Renault ',
      name: 'Service Auto Nord',
      version: '7',
    });

    expect(h.audit.recordChanges).toHaveBeenCalledTimes(1);
    const [, change, before, after] = h.audit.recordChanges.mock
      .calls[0] as unknown as [unknown, object, object, object];
    expect(change).toEqual({
      actorId: 'a-1',
      actorRole: 'garage',
      garageId: GARAGE,
      subjectId: GARAGE,
      subjectType: 'garage',
    });
    expect(before).toEqual({ known_for: 'Dacia' });
    expect(after).toEqual({ known_for: 'Renault' });
  });

  it('records one garage.updated naming the changed fields, for the garage and search', async () => {
    const h = harness();

    await h.save({
      name: 'Service Auto Sud',
      phone: '0733 000 111',
      version: '7',
    });

    expect(h.events.record).toHaveBeenCalledTimes(1);
    expect(h.events.record).toHaveBeenCalledWith(h.tx, {
      audience: { garageId: GARAGE, results: true, type: 'public_garage' },
      kind: 'garage.updated',
      payload: { fields: ['name', 'phone'], garageId: GARAGE },
      subjectId: GARAGE,
    });
  });

  it('stores the phone normalised and keeps it out of the event', async () => {
    const h = harness();

    await h.save({ phone: '0733 000 111', version: '7' });

    expect(h.tx.garage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { phone: '+40733000111', profileVersion: { increment: 1 } },
      }),
    );
    const event = JSON.stringify(h.events.record.mock.calls);
    expect(event).not.toContain('733000111');
    expect(h.events.record).toHaveBeenCalledWith(
      h.tx,
      expect.objectContaining({
        audience: { garageId: GARAGE, results: false, type: 'public_garage' },
      }),
    );
  });

  it('stores an empty description as none', async () => {
    const h = harness();

    await h.save({ description: '   ', version: '7' });

    expect(h.tx.garage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { knownFor: null, profileVersion: { increment: 1 } },
      }),
    );
  });

  it('writes a mobile mechanic its radius', async () => {
    const h = harness({ business_kind: 'mobile', service_radius_km: 20 });

    await h.save({ serviceRadiusKm: 100, version: '7' });

    expect(h.tx.garage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { profileVersion: { increment: 1 }, serviceRadiusKm: 100 },
      }),
    );
  });

  it('writes nothing, keeps the stamp and answers the profile when nothing changes', async () => {
    const h = harness();

    const answer = await h.save({
      closedDays: [],
      description: 'Dacia ',
      hours: WEEK,
      name: ' Service Auto Nord',
      phone: '0722 123 456',
      version: '7',
    });

    nothingWritten(h);
    expect(answer).toEqual({ name: 'answer', version: '8' });
  });

  it('passes the hours through the one hours write with the facilities, note, payments and courtesy car kept', async () => {
    const h = harness();

    await h.save({
      closedDays: [{ day: '2026-12-27', note: 'Inventar' }],
      hours: SATURDAY,
      version: '7',
    });

    expect(write).toHaveBeenCalledTimes(1);
    const [tx, id, section, today] = write.mock.calls[0];
    expect(tx).toBe(h.tx);
    expect(id).toBe(GARAGE);
    expect(section).toEqual({
      closedDays: [{ day: '2026-12-27', note: 'Inventar' }],
      courtesyCar: { paid: true, pricePerDayBani: 15000 },
      facilities: ['courtesy_car', 'waiting_area'],
      facilitiesNote: 'Cafea',
      hours: SATURDAY,
      payments: ['cash', 'transfer'],
    });
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(h.tx.garage.updateMany).toHaveBeenCalledWith({
      data: { profileVersion: { increment: 1 } },
      where: { id: GARAGE, profileVersion: 7 },
    });
    expect(h.audit.recordChanges).not.toHaveBeenCalled();
    expect(h.events.record).toHaveBeenCalledWith(
      h.tx,
      expect.objectContaining({
        audience: { garageId: GARAGE, results: true, type: 'public_garage' },
        payload: { fields: ['hours', 'closed_days'], garageId: GARAGE },
      }),
    );
  });

  it('keeps the stored week when only the closed days are sent', async () => {
    const h = harness();

    await h.save({ closedDays: [{ day: '2026-12-27' }], version: '7' });

    expect(write.mock.calls[0][2]).toMatchObject({ hours: WEEK });
    expect(h.events.record).toHaveBeenCalledWith(
      h.tx,
      expect.objectContaining({
        payload: { fields: ['closed_days'], garageId: GARAGE },
      }),
    );
  });

  it('keeps the stored closed days and their notes when only the week is sent', async () => {
    const h = harness({
      closed_days: [
        { day: '2026-12-27', note: 'Inventar' },
        { day: '2026-12-28', note: null },
      ],
    });

    await h.save({ hours: SATURDAY, version: '7' });

    expect(write.mock.calls[0][2]).toMatchObject({
      closedDays: [
        { day: '2026-12-27', note: 'Inventar' },
        { day: '2026-12-28' },
      ],
      hours: SATURDAY,
    });
    expect(h.events.record).toHaveBeenCalledWith(
      h.tx,
      expect.objectContaining({
        payload: { fields: ['hours'], garageId: GARAGE },
      }),
    );
  });

  it('counts a closed day the write dropped as no change', async () => {
    const h = harness();

    await h.save({
      closedDays: [{ day: '2026-12-25' }],
      hours: WEEK,
      version: '7',
    });

    expect(h.tx.garage.updateMany).not.toHaveBeenCalled();
    expect(h.events.record).not.toHaveBeenCalled();
  });
});
