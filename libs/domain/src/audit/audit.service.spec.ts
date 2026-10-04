import { randomUUID } from 'node:crypto';

import { AuditService } from './audit.service';
import { createPrisma } from '../auth/prisma';
import { serialDatabase } from '../auth/serial-db.testing';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const prisma = createPrisma(databaseUrl);
serialDatabase(databaseUrl);
afterAll(() => prisma.$disconnect());

const audit = new AuditService();

const entriesOf = (subjectId: string) =>
  prisma.activityLog.findMany({
    orderBy: { at: 'asc' },
    where: { subjectId },
  });

const ion = {
  actorId: randomUUID(),
  actorName: 'Ion Popescu',
  actorRole: 'garage' as const,
};

describe('record', () => {
  it('stores who, what, when, old and new', async () => {
    const subjectId = randomUUID();

    await prisma.$transaction((tx) =>
      audit.record(tx, {
        ...ion,
        action: 'update',
        field: 'note',
        newValue: 'cu ulei sintetic',
        oldValue: 'cu ulei mineral',
        subjectId,
        subjectType: 'quote',
      }),
    );

    const [entry] = await entriesOf(subjectId);
    expect(entry).toMatchObject({
      action: 'update',
      actorId: ion.actorId,
      actorName: 'Ion',
      actorRole: 'owner',
      field: 'note',
      internal: false,
      isKeyChange: false,
      newValue: 'cu ulei sintetic',
      oldValue: 'cu ulei mineral',
      subjectType: 'quote',
      viaAssistant: false,
    });
    expect(entry?.at).toBeInstanceOf(Date);
  });

  it('leaves no entry when the transaction rolls back', async () => {
    const subjectId = randomUUID();

    await expect(
      prisma.$transaction(async (tx) => {
        await audit.record(tx, {
          ...ion,
          action: 'create',
          newValue: { from_bani: 120000 },
          subjectId,
          subjectType: 'garage_price',
        });
        throw new Error('the save failed');
      }),
    ).rejects.toThrow('the save failed');

    expect(await entriesOf(subjectId)).toEqual([]);
  });

  it('fails the change when the entry cannot be written', async () => {
    const slug = `atelier-${randomUUID()}`;

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.garage.create({ data: { name: 'Atelier Dinamo', slug } });
        await audit.record(tx, {
          ...ion,
          action: 'create',
          subjectId: 'not-a-uuid',
          subjectType: 'garage',
        });
      }),
    ).rejects.toThrow();

    expect(await prisma.garage.findUnique({ where: { slug } })).toBeNull();
  });

  it('keeps a deleted repair as its old value, with the car', async () => {
    const subjectId = randomUUID();
    const carId = randomUUID();
    const repair = { km: 182000, label: 'Schimb ulei', paid_bani: 45000 };

    await prisma.$transaction((tx) =>
      audit.record(tx, {
        action: 'delete',
        actorId: randomUUID(),
        actorName: 'Andrei',
        actorRole: 'driver',
        carId,
        oldValue: repair,
        subjectId,
        subjectType: 'repair',
      }),
    );

    expect(await entriesOf(subjectId)).toEqual([
      expect.objectContaining({
        action: 'delete',
        actorRole: 'driver',
        carId,
        field: null,
        newValue: null,
        oldValue: repair,
      }),
    ]);
  });

  it('marks a change made through an AI assistant', async () => {
    const subjectId = randomUUID();
    const assistantGrantId = randomUUID();

    await prisma.$transaction((tx) =>
      audit.record(tx, {
        ...ion,
        action: 'update',
        assistantGrantId,
        field: 'to_bani',
        newValue: 160000,
        oldValue: 150000,
        subjectId,
        subjectType: 'quote',
      }),
    );

    expect(await entriesOf(subjectId)).toEqual([
      expect.objectContaining({ assistantGrantId, viaAssistant: true }),
    ]);
  });

  it('names the system MotorFix', async () => {
    const subjectId = randomUUID();

    await prisma.$transaction((tx) =>
      audit.record(tx, {
        action: 'update',
        actorId: null,
        actorName: 'worker',
        actorRole: 'system',
        field: 'status',
        newValue: 'closed',
        oldValue: 'sent',
        subjectId,
        subjectType: 'quote_request',
      }),
    );

    expect(await entriesOf(subjectId)).toEqual([
      expect.objectContaining({
        actorId: null,
        actorName: 'MotorFix',
        actorRole: 'system',
      }),
    ]);
  });

  it('carries the job, car and garage ids and marks a stage change as key', async () => {
    const subjectId = randomUUID();
    const scope = {
      carId: randomUUID(),
      garageId: randomUUID(),
      jobId: subjectId,
    };

    await prisma.$transaction((tx) =>
      audit.record(tx, {
        ...ion,
        ...scope,
        action: 'update',
        field: 'status',
        newValue: 'done',
        oldValue: 'in_work',
        subjectId,
        subjectType: 'job',
      }),
    );

    expect(await entriesOf(subjectId)).toEqual([
      expect.objectContaining({ ...scope, isKeyChange: true }),
    ]);
  });

  it('marks an internal note', async () => {
    const subjectId = randomUUID();

    await prisma.$transaction((tx) =>
      audit.record(tx, {
        action: 'create',
        actorId: randomUUID(),
        actorName: 'Mihai',
        actorRole: 'mechanic',
        internal: true,
        jobId: randomUUID(),
        newValue: { text: 'Plăcuțele din spate sunt la limită.' },
        subjectId,
        subjectType: 'job_note',
      }),
    );

    expect(await entriesOf(subjectId)).toEqual([
      expect.objectContaining({ internal: true, isKeyChange: false }),
    ]);
  });

  it('records an admin opening a private repair, with no values', async () => {
    const subjectId = randomUUID();

    await prisma.$transaction((tx) =>
      audit.record(tx, {
        action: 'open',
        actorId: randomUUID(),
        actorName: 'Ana',
        actorRole: 'admin',
        subjectId,
        subjectType: 'repair',
      }),
    );

    expect(await entriesOf(subjectId)).toEqual([
      expect.objectContaining({
        action: 'open',
        actorRole: 'admin',
        newValue: null,
        oldValue: null,
      }),
    ]);
  });

  it.each([
    ['quote', 'from_bani'],
    ['quote', 'to_bani'],
    ['job', 'final_price_bani'],
    ['job', 'status'],
    ['job', 'eta_at'],
    ['booking', 'starts_at'],
    ['booking', 'mechanic_id'],
  ])('marks %s.%s as a key change', async (subjectType, field) => {
    const subjectId = randomUUID();

    await prisma.$transaction((tx) =>
      audit.record(tx, {
        ...ion,
        action: 'update',
        field,
        newValue: 1,
        oldValue: 0,
        subjectId,
        subjectType,
      }),
    );

    expect(await entriesOf(subjectId)).toEqual([
      expect.objectContaining({ isKeyChange: true }),
    ]);
  });

  it('does not mark a price list range as a key change', async () => {
    const subjectId = randomUUID();

    await prisma.$transaction((tx) =>
      audit.record(tx, {
        ...ion,
        action: 'update',
        field: 'from_bani',
        newValue: 130000,
        oldValue: 120000,
        subjectId,
        subjectType: 'garage_price',
      }),
    );

    expect(await entriesOf(subjectId)).toEqual([
      expect.objectContaining({ isKeyChange: false }),
    ]);
  });

  it("looks the actor's first name up from the account when none is given", async () => {
    const subjectId = randomUUID();
    const { id } = await prisma.account.create({
      data: {
        lastRole: 'mechanic',
        name: '  Elena Ionescu ',
        roles: { create: [{ role: 'mechanic' }] },
      },
    });

    await prisma.$transaction((tx) =>
      audit.record(tx, {
        action: 'update',
        actorId: id,
        actorRole: 'mechanic',
        field: 'eta_at',
        newValue: '2026-10-05T14:00:00.000Z',
        oldValue: null,
        subjectId,
        subjectType: 'job',
      }),
    );

    expect(await entriesOf(subjectId)).toEqual([
      expect.objectContaining({ actorName: 'Elena' }),
    ]);
  });

  it('writes an empty name for an actor with no account and no name', async () => {
    const subjectId = randomUUID();

    await prisma.$transaction((tx) =>
      audit.record(tx, {
        action: 'create',
        actorId: randomUUID(),
        actorRole: 'driver',
        subjectId,
        subjectType: 'car',
      }),
    );

    expect(await entriesOf(subjectId)).toEqual([
      expect.objectContaining({ actorName: '' }),
    ]);
  });

  it('stores dates as UTC strings, and kind and text as given', async () => {
    const subjectId = randomUUID();

    await prisma.$transaction((tx) =>
      audit.record(tx, {
        ...ion,
        action: 'update',
        field: 'starts_at',
        kind: 'booking.moved',
        newValue: new Date('2026-10-06T07:00:00+03:00'),
        oldValue: new Date('2026-10-05T07:00:00+03:00'),
        subjectId,
        subjectType: 'booking',
        text: 'Clientul a cerut altă zi.',
      }),
    );

    expect(await entriesOf(subjectId)).toEqual([
      expect.objectContaining({
        kind: 'booking.moved',
        newValue: '2026-10-06T04:00:00.000Z',
        oldValue: '2026-10-05T04:00:00.000Z',
        text: 'Clientul a cerut altă zi.',
      }),
    ]);
  });
});

describe('recordChanges', () => {
  it('writes one entry per changed field, in the same transaction, in order', async () => {
    const subjectId = randomUUID();
    const garageId = randomUUID();

    await prisma.$transaction((tx) =>
      audit.recordChanges(
        tx,
        { ...ion, garageId, subjectId, subjectType: 'garage_price' },
        { duration_minutes: 60, from_bani: 120000, to_bani: 150000 },
        { duration_minutes: 60, from_bani: 130000, to_bani: 160000 },
      ),
    );

    const entries = await entriesOf(subjectId);
    expect(entries).toEqual([
      expect.objectContaining({
        action: 'update',
        actorName: 'Ion',
        actorRole: 'owner',
        field: 'from_bani',
        garageId,
        newValue: 130000,
        oldValue: 120000,
      }),
      expect.objectContaining({
        action: 'update',
        actorName: 'Ion',
        actorRole: 'owner',
        field: 'to_bani',
        garageId,
        newValue: 160000,
        oldValue: 150000,
      }),
    ]);
    expect(entries[0]!.at.getTime()).toBeLessThanOrEqual(
      entries[1]!.at.getTime(),
    );
  });

  it('writes nothing when no field changed, comparing values by content', async () => {
    const subjectId = randomUUID();

    await prisma.$transaction((tx) =>
      audit.recordChanges(
        tx,
        { ...ion, subjectId, subjectType: 'garage' },
        { hours: { mon: '08-18' }, name: 'Atelier Dinamo' },
        { hours: { mon: '08-18' }, name: 'Atelier Dinamo' },
      ),
    );

    expect(await entriesOf(subjectId)).toEqual([]);
  });

  it('records a corrected final price as a key change on the job', async () => {
    const jobId = randomUUID();

    await prisma.$transaction((tx) =>
      audit.recordChanges(
        tx,
        { ...ion, jobId, subjectId: jobId, subjectType: 'job' },
        { final_price_bani: 145000 },
        { final_price_bani: 138000 },
      ),
    );

    expect(await entriesOf(jobId)).toEqual([
      expect.objectContaining({
        field: 'final_price_bani',
        isKeyChange: true,
        jobId,
        newValue: 138000,
        oldValue: 145000,
      }),
    ]);
  });
});

describe('the history is append-only', () => {
  let subjectId: string;

  beforeAll(async () => {
    subjectId = randomUUID();
    await prisma.$transaction((tx) =>
      audit.record(tx, {
        ...ion,
        action: 'create',
        subjectId,
        subjectType: 'garage',
      }),
    );
  });

  it('refuses an update', async () => {
    await expect(
      prisma.$executeRaw`UPDATE activity_log SET text = 'rewritten' WHERE subject_id = ${subjectId}::uuid`,
    ).rejects.toThrow(/append-only/);
  });

  it('refuses a delete', async () => {
    await expect(
      prisma.$executeRaw`DELETE FROM activity_log WHERE subject_id = ${subjectId}::uuid`,
    ).rejects.toThrow(/append-only/);
  });

  it('refuses a truncate', async () => {
    await expect(
      prisma.$executeRawUnsafe('TRUNCATE activity_log'),
    ).rejects.toThrow(/append-only/);
    expect(await entriesOf(subjectId)).toHaveLength(1);
  });
});
