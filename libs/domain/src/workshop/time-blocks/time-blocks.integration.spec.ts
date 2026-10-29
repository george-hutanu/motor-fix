import { todayInBucharest } from '@motor-fix/contracts';
import { Logger } from '@nestjs/common';

import { addDays, atLocal } from '../../bucharest';
import { outboxMark } from '../../events/outbox.testing';
import { heldOpen, lockWaited } from '../../held-open.testing';
import { quotesApp } from '../../quotes/quotes-api.testing';

const { bearer, client, get, send, team, world } = quotesApp();
const { prisma } = world;

// A Thursday-like working day a week ahead, so every block is in the future.
const DAY = addDays(todayInBucharest(), 7);
const at = (hour: number, minute = 0, day = DAY) =>
  new Date(atLocal(day, hour).getTime() + minute * 60_000).toISOString();

async function setting() {
  const t = await team('Atelier Dinamo');
  await prisma.garage.update({
    data: { liftCount: 3 },
    where: { id: t.garage.id },
  });
  const owner = bearer(t.owner, 'garage');
  const desk = bearer(t.receptionist, 'receptionist');
  const path = `/garages/${t.garage.id}/time-blocks`;
  const mihai = t.plainMechanic;
  return { ...t, desk, mihai, owner, path };
}
type Setting = Awaited<ReturnType<typeof setting>>;

const create = (s: Setting, body: object, auth = s.desk) =>
  send('post', s.path, auth, body);
const english = (accountId: string) =>
  prisma.account.update({ data: { language: 'en' }, where: { id: accountId } });
const switchOff = (garageId: string, key: string) =>
  prisma.garageFeature.upsert({
    create: { enabled: false, garageId, key },
    update: { enabled: false },
    where: { garageId_key: { garageId, key } },
  });
const segments = (timeBlockId: string) =>
  prisma.bookingSegment.findMany({
    orderBy: { startsAt: 'asc' },
    select: { endsAt: true, lift: true, mechanicId: true, startsAt: true },
    where: { timeBlockId },
  });
const entries = (subjectId: string) =>
  prisma.activityLog.findMany({
    orderBy: { at: 'asc' },
    where: { subjectId, subjectType: 'time_block' },
  });
const events = (mark: bigint) =>
  prisma.outboxEvent.findMany({
    orderBy: { id: 'asc' },
    where: { id: { gt: mark }, kind: { startsWith: 'time_block.' } },
  });

beforeEach(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation());
afterEach(() => jest.restoreAllMocks());

// @traces 427-FR-003
// @traces 427-FR-005
// @traces 427-FR-009
// @traces 427-FR-010
describe('blocking time', () => {
  it('saves a block on a lift and a mechanic, with its day segment, entry and event', async () => {
    const s = await setting();
    const mark = await outboxMark(prisma);

    const res = await create(s, {
      endsAt: at(11, 30),
      lift: 2,
      mechanicId: s.mihai.id,
      note: '  Client la telefon: Ford Focus, plăcuțe  ',
      startsAt: at(10),
    });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      endsAt: at(11, 30),
      id: expect.any(String),
      lift: 2,
      mechanic: { id: s.mihai.id, name: 'Hand' },
      note: 'Client la telefon: Ford Focus, plăcuțe',
      segments: [{ endsAt: at(11, 30), startsAt: at(10) }],
      startsAt: at(10),
    });
    expect(await segments(res.body.id)).toEqual([
      {
        endsAt: new Date(at(11, 30)),
        lift: 2,
        mechanicId: s.mihai.id,
        startsAt: new Date(at(10)),
      },
    ]);
    expect(await entries(res.body.id)).toEqual([
      expect.objectContaining({
        action: 'create',
        actorId: s.receptionist,
        actorRole: 'receptionist',
        garageId: s.garage.id,
        internal: true,
        newValue: {
          endsAt: at(11, 30),
          lift: 2,
          mechanicId: s.mihai.id,
          mechanicName: 'Hand',
          note: 'Client la telefon: Ford Focus, plăcuțe',
          startsAt: at(10),
        },
      }),
    ]);
    const [event] = await events(mark);
    expect(event).toMatchObject({
      audience: [
        `garage:${s.garage.id}`,
        `mechanic:${s.mihai.id}`,
        `public:garage:${s.garage.id}`,
      ],
      kind: 'time_block.created',
      payload: {
        blockId: res.body.id,
        endsAt: at(11, 30),
        garageId: s.garage.id,
        lift: 2,
        mechanicId: s.mihai.id,
        startsAt: at(10),
      },
      subjectId: res.body.id,
    });
    expect(JSON.stringify(event.payload)).not.toContain('Ford');
  });

  it('cuts a block over a weekend into one segment per Bucharest day', async () => {
    const s = await setting();
    const next = (n: number) => addDays(DAY, n);

    const res = await create(s, {
      endsAt: at(10, 0, next(3)),
      lift: 1,
      startsAt: at(16),
    });

    expect(res.status).toBe(201);
    expect(res.body.segments).toEqual([
      { endsAt: at(0, 0, next(1)), startsAt: at(16) },
      { endsAt: at(0, 0, next(2)), startsAt: at(0, 0, next(1)) },
      { endsAt: at(0, 0, next(3)), startsAt: at(0, 0, next(2)) },
      { endsAt: at(10, 0, next(3)), startsAt: at(0, 0, next(3)) },
    ]);
    expect(await segments(res.body.id)).toHaveLength(4);
  });

  it('refuses a mechanic with a booking, naming it, and writes nothing', async () => {
    const s = await setting();
    await world.booked(s.garage.id, at(13), 'confirmed', {
      mechanicId: s.mihai.id,
    });
    const mark = await outboxMark(prisma);

    const res = await create(s, {
      endsAt: at(15),
      mechanicId: s.mihai.id,
      startsAt: at(13, 30),
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'mechanic_busy',
      errors: [{ code: 'busy', field: 'mechanicId' }],
      message: 'Hand are o programare 13:00–14:30',
    });
    expect(res.body.reason).toBeUndefined();
    expect(await prisma.timeBlock.count()).toBe(0);
    expect(await events(mark)).toEqual([]);
  });

  it('refuses a lift another block holds, in both languages', async () => {
    const s = await setting();
    await create(s, { endsAt: at(11, 30), lift: 2, startsAt: at(10) });

    const ro = await create(s, { endsAt: at(12), lift: 2, startsAt: at(11) });
    await english(s.receptionist);
    const en = await create(s, { endsAt: at(12), lift: 2, startsAt: at(11) });

    expect(ro.status).toBe(409);
    expect(ro.body).toMatchObject({
      code: 'lift_busy',
      errors: [{ code: 'busy', field: 'lift' }],
      message: 'Elevatorul 2 e blocat 10:00–11:30',
      reason: 'time_block',
    });
    expect(en.body).toMatchObject({
      message: 'Lift 2 is blocked 10:00–11:30',
      reason: 'time_block',
    });
    expect(await prisma.timeBlock.count()).toBe(1);
  });

  it('saves a block over a booking still awaiting its confirm', async () => {
    const s = await setting();
    await world.booked(s.garage.id, at(10), 'awaiting_confirmation', {
      mechanicId: s.mihai.id,
    });

    const res = await create(s, {
      endsAt: at(11),
      mechanicId: s.mihai.id,
      startsAt: at(10),
    });

    expect(res.status).toBe(201);
  });

  it('keeps one of two blocks saved at once on one lift, the other 409 slot_taken', async () => {
    const s = await setting();
    // The first save holds its segment uncommitted past the second's read.
    const first = heldOpen(client(), async (tx) => {
      const { id } = await tx.timeBlock.create({
        data: {
          createdBy: s.owner,
          endsAt: new Date(at(12)),
          garageId: s.garage.id,
          lift: 2,
          startsAt: new Date(at(10)),
          updatedBy: s.owner,
        },
      });
      await tx.bookingSegment.create({
        data: {
          endsAt: new Date(at(12)),
          garageId: s.garage.id,
          lift: 2,
          startsAt: new Date(at(10)),
          timeBlockId: id,
        },
      });
    });
    await first.ready;

    const second = create(s, { endsAt: at(11, 30), lift: 2, startsAt: at(11) });
    await lockWaited(prisma);
    first.release();
    await first.done;
    const res = await second;

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'slot_taken',
      message: 'Locul tocmai a fost ocupat',
    });
    expect(await prisma.timeBlock.count()).toBe(1);
  });
});

// @traces 427-FR-004
describe('the refusals of a block, in their order', () => {
  it.each([
    ['neither a mechanic nor a lift', {}, 422, 'nothing_to_block', undefined],
    [
      'a card of another garage',
      { mechanicId: 'other' },
      422,
      'validation_failed',
      'mechanicId',
    ],
    // The DTO's own refusal: the API's problem filter names it validation_failed.
    ['lift 0', { lift: 0 }, 400, undefined, undefined],
    ['lift 4 of 3', { lift: 4 }, 422, 'validation_failed', 'lift'],
    [
      'a start off the quarter hour',
      { lift: 1, startsAt: at(10, 5) },
      422,
      'validation_failed',
      'startsAt',
    ],
    [
      'an end off the quarter hour',
      { endsAt: at(11, 10), lift: 1 },
      422,
      'validation_failed',
      'endsAt',
    ],
    [
      'an end at the start',
      { endsAt: at(10), lift: 1 },
      422,
      'validation_failed',
      'endsAt',
    ],
    [
      'an end before the start',
      { endsAt: at(9), lift: 1 },
      422,
      'validation_failed',
      'endsAt',
    ],
    [
      'a range over 14 days',
      { endsAt: at(10, 15, addDays(DAY, 14)), lift: 1 },
      422,
      'validation_failed',
      'endsAt',
    ],
    [
      'an end already past',
      {
        endsAt: at(10, 0, addDays(DAY, -8)),
        lift: 1,
        startsAt: at(9, 0, addDays(DAY, -8)),
      },
      422,
      'validation_failed',
      'endsAt',
    ],
    [
      'a note over 200 characters',
      { lift: 1, note: 'x'.repeat(201) },
      422,
      'validation_failed',
      'note',
    ],
  ] as const)('refuses %s', async (_, over, status, code, field) => {
    const s = await setting();
    const other = await team('Service Militari');
    const body = {
      endsAt: at(11),
      startsAt: at(10),
      ...over,
      ...('mechanicId' in over && {
        mechanicId: other.plainMechanic.id,
      }),
    };

    const res = await create(s, body);

    expect(res.status).toBe(status);
    if (code) expect(res.body.code).toBe(code);
    if (field) expect(res.body.errors).toEqual([{ code: 'invalid', field }]);
    expect(await prisma.timeBlock.count()).toBe(0);
  });

  it('takes exactly 15 minutes and exactly 14 days, and a 200-character note trimmed', async () => {
    const s = await setting();

    const short = await create(s, {
      endsAt: at(10, 15),
      lift: 1,
      startsAt: at(10),
    });
    const long = await create(s, {
      endsAt: at(10, 0, addDays(DAY, 14)),
      lift: 2,
      startsAt: at(10),
    });
    const noted = await create(s, {
      endsAt: at(11),
      lift: 3,
      note: ` ${'x'.repeat(200)} `,
      startsAt: at(10),
    });
    const empty = await create(s, {
      endsAt: at(11),
      mechanicId: s.mihai.id,
      note: '   ',
      startsAt: at(10),
    });

    expect([short.status, long.status, noted.status, empty.status]).toEqual([
      201, 201, 201, 201,
    ]);
    expect(noted.body.note).toHaveLength(200);
    expect(empty.body.note).toBeNull();
  });

  it('refuses a removed card', async () => {
    const s = await setting();
    await prisma.mechanic.update({
      data: { removedAt: new Date() },
      where: { id: s.mihai.id },
    });

    const res = await create(s, {
      endsAt: at(11),
      mechanicId: s.mihai.id,
      startsAt: at(10),
    });

    expect(res.status).toBe(422);
    expect(res.body.errors).toEqual([{ code: 'invalid', field: 'mechanicId' }]);
  });

  it('says nothing_to_block before feature_off, and feature_off before the fields', async () => {
    const s = await setting();
    await switchOff(s.garage.id, 'team_mechanics');

    const none = await create(s, { endsAt: at(11), startsAt: at(10) });
    const off = await create(s, {
      endsAt: at(10, 5),
      mechanicId: s.mihai.id,
      startsAt: at(10),
    });

    expect(none.status).toBe(422);
    expect(none.body).toMatchObject({
      code: 'nothing_to_block',
      message: 'Nu e nimic de blocat: pornește echipa sau elevatoarele',
    });
    expect(off.status).toBe(404);
    expect(off.body.code).toBe('feature_off');
  });
});

// @traces 427-FR-007
// @traces 427-FR-008
// @traces 427-FR-009
// @traces 427-FR-010
describe('changing and removing a block', () => {
  async function blocked() {
    const s = await setting();
    const res = await create(s, {
      endsAt: at(11, 30),
      lift: 2,
      mechanicId: s.mihai.id,
      note: 'Client la telefon',
      startsAt: at(10),
    });
    return {
      ...s,
      block: `${s.path}/${res.body.id}`,
      id: res.body.id as string,
    };
  }

  it('moves its end, rewrites its segments and writes one update entry and event', async () => {
    const s = await blocked();
    const mark = await outboxMark(prisma);

    const res = await send('patch', s.block, s.owner, { endsAt: at(12) });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      endsAt: at(12),
      note: 'Client la telefon',
    });
    expect(await segments(s.id)).toEqual([
      expect.objectContaining({ endsAt: new Date(at(12)) }),
    ]);
    const updates = (await entries(s.id)).filter((e) => e.action === 'update');
    expect(updates).toEqual([
      expect.objectContaining({
        actorId: s.owner,
        actorRole: 'owner',
        field: 'endsAt',
        newValue: at(12),
        oldValue: at(11, 30),
      }),
    ]);
    expect((await events(mark)).map((e) => e.kind)).toEqual([
      'time_block.updated',
    ]);
    const stored = await prisma.timeBlock.findUniqueOrThrow({
      where: { id: s.id },
    });
    expect(stored.updatedBy).toBe(s.owner);
  });

  it('refuses a change onto a booking, leaving the block as it was', async () => {
    const s = await blocked();
    await world.booked(s.garage.id, at(12), 'confirmed', {
      mechanicId: s.mihai.id,
    });

    const res = await send('patch', s.block, s.owner, { endsAt: at(12, 30) });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'mechanic_busy',
      message: 'Hand are o programare 12:00–13:30',
    });
    expect(
      await prisma.timeBlock.findUniqueOrThrow({ where: { id: s.id } }),
    ).toMatchObject({ endsAt: new Date(at(11, 30)) });
  });

  it('does not meet its own segments when it grows', async () => {
    const s = await blocked();

    const res = await send('patch', s.block, s.desk, { startsAt: at(9, 30) });

    expect(res.status).toBe(200);
    expect(await segments(s.id)).toEqual([
      expect.objectContaining({ startsAt: new Date(at(9, 30)) }),
    ]);
  });

  it('changes a note without rewriting a segment', async () => {
    const s = await blocked();
    const [before] = await prisma.bookingSegment.findMany({
      where: { timeBlockId: s.id },
    });
    const mark = await outboxMark(prisma);

    const res = await send('patch', s.block, s.desk, { note: 'Ford Focus' });

    expect(res.status).toBe(200);
    const [after] = await prisma.bookingSegment.findMany({
      where: { timeBlockId: s.id },
    });
    expect(after.id).toBe(before.id);
    const updates = (await entries(s.id)).filter((e) => e.action === 'update');
    expect(updates.map((e) => e.field)).toEqual(['note']);
    expect((await events(mark)).map((e) => e.kind)).toEqual([
      'time_block.updated',
    ]);
  });

  it('answers a change with nothing changed and writes nothing', async () => {
    const s = await blocked();
    const mark = await outboxMark(prisma);

    const res = await send('patch', s.block, s.desk, { lift: 2 });

    expect(res.status).toBe(200);
    expect((await entries(s.id)).map((e) => e.action)).toEqual(['create']);
    expect(await events(mark)).toEqual([]);
  });

  it('removes it with its segments, one delete entry and one event, freeing the time', async () => {
    const s = await blocked();
    const mark = await outboxMark(prisma);

    const res = await send('delete', s.block, s.desk);

    expect(res.status).toBe(204);
    expect(await prisma.timeBlock.count()).toBe(0);
    expect(await prisma.bookingSegment.count()).toBe(0);
    expect((await entries(s.id)).at(-1)).toMatchObject({
      action: 'delete',
      actorRole: 'receptionist',
      oldValue: {
        endsAt: at(11, 30),
        lift: 2,
        mechanicId: s.mihai.id,
        mechanicName: 'Hand',
        note: 'Client la telefon',
        startsAt: at(10),
      },
    });
    expect(await events(mark)).toEqual([
      expect.objectContaining({
        audience: [
          `garage:${s.garage.id}`,
          `mechanic:${s.mihai.id}`,
          `public:garage:${s.garage.id}`,
        ],
        kind: 'time_block.deleted',
      }),
    ]);
    const again = await create(s, {
      endsAt: at(11),
      lift: 2,
      startsAt: at(10),
    });
    expect(again.status).toBe(201);
  });

  it('refuses to change or remove a block that already ended', async () => {
    const s = await setting();
    const past = await prisma.timeBlock.create({
      data: {
        createdBy: s.owner,
        endsAt: new Date(Date.now() - 86_400_000),
        garageId: s.garage.id,
        lift: 1,
        startsAt: new Date(Date.now() - 2 * 86_400_000),
        updatedBy: s.owner,
      },
    });
    const path = `${s.path}/${past.id}`;

    const change = await send('patch', path, s.owner, { note: 'x' });
    await english(s.owner);
    const removal = await send('delete', path, s.owner);

    expect(change.status).toBe(409);
    expect(change.body).toMatchObject({
      code: 'block_past',
      message: 'Un interval blocat trecut nu se mai poate modifica',
    });
    expect(removal.body).toMatchObject({
      code: 'block_past',
      message: 'A past blocked interval can no longer be changed',
    });
    expect(await prisma.timeBlock.count()).toBe(1);
  });

  it("answers 404 for another garage's block or an unknown one", async () => {
    const s = await blocked();
    const other = await team('Service Militari');
    const theirs = `/garages/${other.garage.id}/time-blocks/${s.id}`;

    const res = await send('patch', theirs, bearer(other.owner, 'garage'), {
      note: 'x',
    });
    const unknown = await send(
      'delete',
      `${s.path}/00000000-0000-4000-8000-000000000000`,
      s.owner,
    );

    expect(res.status).toBe(404);
    expect(unknown.status).toBe(404);
  });

  it('lists the blocks touching the asked days, and refuses over 31 days', async () => {
    const s = await blocked();

    const res = await get(`${s.path}?from=${DAY}`, s.desk);
    const later = await get(`${s.path}?from=${addDays(DAY, 1)}`, s.desk);
    const wide = await get(
      `${s.path}?from=${DAY}&to=${addDays(DAY, 31)}`,
      s.desk,
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      blocks: [{ id: s.id, note: 'Client la telefon' }],
      from: DAY,
      lifts: true,
      to: DAY,
    });
    expect(later.body.blocks).toEqual([]);
    expect(wide.status).toBe(400);
    expect(wide.body.code).toBe('validation_failed');
  });
});
