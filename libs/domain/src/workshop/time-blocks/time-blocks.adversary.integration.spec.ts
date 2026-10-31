import { todayInBucharest } from '@motor-fix/contracts';
import { Logger } from '@nestjs/common';
import type { MockInstance } from 'vitest';

import { addDays, atLocal } from '../../bucharest';
import { outboxMark } from '../../events/outbox.testing';
import { quotesApp } from '../../quotes/quotes-api.testing';

const { bearer, get, send, team, world } = quotesApp();
const { prisma } = world;

const DAY = addDays(todayInBucharest(), 7);
const at = (hour: number, minute = 0, day = DAY) =>
  new Date(atLocal(day, hour).getTime() + minute * 60_000).toISOString();
// The quarter-hour mark `n` quarters before the current one: past, on the grid.
const QUARTER = 15 * 60_000;
const quarterAgo = (n: number) =>
  new Date((Math.floor(Date.now() / QUARTER) - n) * QUARTER);

async function setting() {
  const t = await team('Atelier Dinamo');
  await prisma.garage.update({
    data: { liftCount: 3 },
    where: { id: t.garage.id },
  });
  const owner = bearer(t.owner, 'garage');
  const desk = bearer(t.receptionist, 'receptionist');
  const path = `/garages/${t.garage.id}/time-blocks`;
  return {
    ...t,
    desk,
    mihai: t.plainMechanic,
    owner,
    ownerId: t.owner,
    path,
  };
}
type Setting = Awaited<ReturnType<typeof setting>>;

const create = (s: Setting, body: object, auth = s.desk) =>
  send('post', s.path, auth, body);
const english = (accountId: string) =>
  prisma.account.update({ data: { language: 'en' }, where: { id: accountId } });
const entries = (subjectId: string) =>
  prisma.activityLog.findMany({
    orderBy: { at: 'asc' },
    where: { subjectId, subjectType: 'time_block' },
  });
const segments = (timeBlockId: string) =>
  prisma.bookingSegment.findMany({
    orderBy: { startsAt: 'asc' },
    select: { endsAt: true, lift: true, mechanicId: true, startsAt: true },
    where: { timeBlockId },
  });
const ended = (s: Setting, over: object = {}) =>
  prisma.timeBlock.create({
    data: {
      createdBy: s.ownerId,
      endsAt: new Date(Date.now() - 86_400_000),
      garageId: s.garage.id,
      lift: 1,
      startsAt: new Date(Date.now() - 2 * 86_400_000),
      updatedBy: s.ownerId,
      ...over,
    },
  });

let warn: MockInstance;
beforeEach(() => {
  warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

// @traces 427-FR-004
describe('what a block accepts, pushed', () => {
  it('counts a note of 200 emoji as 200 characters and refuses 201', async () => {
    const s = await setting();
    const ok = await create(s, {
      endsAt: at(11),
      lift: 1,
      note: '🔧'.repeat(200),
      startsAt: at(10),
    });
    const over = await create(s, {
      endsAt: at(13),
      lift: 1,
      note: '🔧'.repeat(201),
      startsAt: at(12),
    });

    expect(ok.status).toBe(201);
    expect(ok.body.note).toBe('🔧'.repeat(200));
    expect(over.status).toBe(422);
    expect(over.body.errors[0]).toMatchObject({ field: 'note' });
  });

  it('saves a note of only spaces as none', async () => {
    const s = await setting();

    const res = await create(s, {
      endsAt: at(11),
      lift: 1,
      note: ' \t\n ',
      startsAt: at(10),
    });

    expect(res.status).toBe(201);
    expect(res.body.note).toBeNull();
  });

  it('keeps markup in a note exactly as written', async () => {
    const s = await setting();
    const note = '<b>Ford</b> & "Focus" <script>alert(1)</script>';

    const res = await create(s, {
      endsAt: at(11),
      lift: 1,
      note,
      startsAt: at(10),
    });

    expect(res.status).toBe(201);
    expect(res.body.note).toBe(note);
  });

  it('refuses a note holding a NUL character without a 500 and writes nothing', async () => {
    const s = await setting();

    const res = await create(s, {
      endsAt: at(11),
      lift: 1,
      note: 'a\u0000b',
      startsAt: at(10),
    });

    expect(res.status).toBe(422);
    expect(res.body.errors[0]).toMatchObject({ field: 'note' });
    expect(await prisma.timeBlock.count()).toBe(0);
  });

  it.each([
    [
      'seconds on the start',
      { startsAt: at(10).replace(':00.000Z', ':30.000Z') },
    ],
    [
      'a millisecond on the start',
      { startsAt: at(10).replace('.000Z', '.001Z') },
    ],
    ['seconds on the end', { endsAt: at(11).replace(':00.000Z', ':01.000Z') }],
  ])('refuses %s', async (_title, over) => {
    const s = await setting();

    const res = await create(s, {
      endsAt: at(11),
      lift: 1,
      startsAt: at(10),
      ...over,
    });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('validation_failed');
    expect(await prisma.timeBlock.count()).toBe(0);
  });

  it('reads the same instant written with an offset as the same block', async () => {
    const s = await setting();
    const offset = (iso: string) =>
      new Date(new Date(iso).getTime() + 3 * 3_600_000)
        .toISOString()
        .replace('Z', '+03:00');

    const res = await create(s, {
      endsAt: offset(at(11)),
      lift: 1,
      startsAt: offset(at(10)),
    });

    expect(res.status).toBe(201);
    expect(res.body.startsAt).toBe(at(10));
  });

  it.each([
    ['a date with no time', { startsAt: DAY }],
    ['a time with no zone', { startsAt: `${DAY}T10:00:00` }],
  ])('refuses a start written as %s, 400', async (_title, over) => {
    const s = await setting();

    const res = await create(s, { endsAt: at(11), lift: 1, ...over });

    expect(res.status).toBe(400);
    expect(await prisma.timeBlock.count()).toBe(0);
  });

  it.each([
    ['an array', [] as unknown as object],
    ['an empty object', {}],
    ['a null range', { endsAt: null, lift: 1, startsAt: null }],
    ['a number for the range', { endsAt: 2, lift: 1, startsAt: 1 }],
  ])('answers %s with 400', async (_title, body) => {
    const s = await setting();

    const res = await send('post', s.path, s.owner, body);

    expect(res.status).toBe(400);
  });

  it('refuses a lift beyond the integer range as validation, not a server error', async () => {
    const s = await setting();

    const res = await create(s, {
      endsAt: at(11),
      lift: 2_147_483_648,
      startsAt: at(10),
    });

    expect(res.status).toBe(422);
    expect(res.body.errors[0]).toMatchObject({ field: 'lift' });
  });

  it('accepts the last lift and refuses the one past it', async () => {
    const s = await setting();

    const last = await create(s, { endsAt: at(11), lift: 3, startsAt: at(10) });
    const past = await create(s, { endsAt: at(11), lift: 4, startsAt: at(10) });

    expect(last.status).toBe(201);
    expect(past.status).toBe(422);
    expect(past.body.errors[0]).toMatchObject({ field: 'lift' });
  });

  it.each([
    [
      'another garage',
      async (_s: Setting) => (await team('Service Militari')).plainMechanic.id,
    ],
    ['no card at all', async () => '3f2b8c1e-5d4a-4b6f-8a7c-1d2e3f4a5b6c'],
  ])(
    'refuses a mechanic from %s with 422 on mechanicId',
    async (_title, pick) => {
      const s = await setting();
      const mechanicId = await pick(s);

      const res = await create(s, {
        endsAt: at(11),
        mechanicId,
        startsAt: at(10),
      });

      expect(res.status).toBe(422);
      expect(res.body.errors[0]).toMatchObject({ field: 'mechanicId' });
      expect(await prisma.timeBlock.count()).toBe(0);
    },
  );

  it('saves a block that began twenty minutes ago and ends ahead', async () => {
    const s = await setting();
    const quarter = 15 * 60_000;
    const start = new Date(
      Math.floor(Date.now() / quarter) * quarter - 2 * quarter,
    );
    const end = new Date(start.getTime() + 2 * 3_600_000);

    const res = await create(s, {
      endsAt: end.toISOString(),
      lift: 1,
      startsAt: start.toISOString(),
    });

    expect(res.status).toBe(201);
  });

  it('refuses a block that ended a quarter hour ago', async () => {
    const s = await setting();
    const quarter = 15 * 60_000;
    const end = new Date(Math.floor(Date.now() / quarter) * quarter - quarter);
    const start = new Date(end.getTime() - 3_600_000);

    const res = await create(s, {
      endsAt: end.toISOString(),
      lift: 1,
      startsAt: start.toISOString(),
    });

    expect(res.status).toBe(422);
    expect(res.body.errors[0]).toMatchObject({ field: 'endsAt' });
  });

  it('writes no note into any log line of a refusal', async () => {
    const s = await setting();
    await create(s, { endsAt: at(11), lift: 1, startsAt: at(10) });

    await create(s, {
      endsAt: at(11),
      lift: 1,
      note: 'Telefon 0722 123 456, Ion Pop',
      startsAt: at(10),
    });

    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('0722');
  });

  it('keeps the note out of the event payload', async () => {
    const s = await setting();
    const mark = await outboxMark(prisma);

    await create(s, {
      endsAt: at(11),
      lift: 1,
      note: 'Telefon 0722 123 456',
      startsAt: at(10),
    });

    const events = await prisma.outboxEvent.findMany({
      where: { id: { gt: mark } },
    });
    expect(events.length).toBeGreaterThan(0);
    // An outbox id is a bigint, which JSON cannot write as it is.
    const written = JSON.stringify(events, (_key, value) =>
      typeof value === 'bigint' ? String(value) : value,
    );
    expect(written).not.toContain('0722');
  });
});

// @traces 427-FR-005
describe('the clash check, pushed', () => {
  it('lets a block start exactly where another ends on the same lift and mechanic', async () => {
    const s = await setting();
    const one = await create(s, {
      endsAt: at(11),
      lift: 1,
      mechanicId: s.mihai.id,
      startsAt: at(10),
    });

    const next = await create(s, {
      endsAt: at(12),
      lift: 1,
      mechanicId: s.mihai.id,
      startsAt: at(11),
    });

    expect(one.status).toBe(201);
    expect(next.status).toBe(201);
  });

  it('refuses an overlap of one quarter hour', async () => {
    const s = await setting();
    await create(s, { endsAt: at(11), lift: 1, startsAt: at(10) });

    const res = await create(s, {
      endsAt: at(12),
      lift: 1,
      startsAt: at(10, 45),
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'lift_busy', reason: 'time_block' });
    expect(res.body.errors[0]).toMatchObject({ field: 'lift' });
  });

  it('names the mechanic before the lift when both clash', async () => {
    const s = await setting();
    await create(s, {
      endsAt: at(11),
      lift: 1,
      mechanicId: s.mihai.id,
      startsAt: at(10),
    });

    const res = await create(s, {
      endsAt: at(11),
      lift: 1,
      mechanicId: s.mihai.id,
      startsAt: at(10),
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('mechanic_busy');
    expect(res.body.errors[0]).toMatchObject({ field: 'mechanicId' });
  });

  it('refuses the same mechanic on another lift at the same time', async () => {
    const s = await setting();
    await create(s, {
      endsAt: at(11),
      lift: 1,
      mechanicId: s.mihai.id,
      startsAt: at(10),
    });

    const res = await create(s, {
      endsAt: at(11),
      lift: 2,
      mechanicId: s.mihai.id,
      startsAt: at(10),
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('mechanic_busy');
  });

  it('lets two mechanics share one time when neither holds a lift', async () => {
    const s = await setting();
    const one = await create(s, {
      endsAt: at(11),
      mechanicId: s.mihai.id,
      startsAt: at(10),
    });

    const other = await create(s, {
      endsAt: at(11),
      mechanicId: s.answeringMechanic.id,
      startsAt: at(10),
    });

    expect(one.status).toBe(201);
    expect(other.status).toBe(201);
  });

  it('names the whole range of a multi-day block that a Sunday block meets', async () => {
    const s = await setting();
    await english(s.receptionist);
    const first = await create(s, {
      endsAt: at(10, 0, addDays(DAY, 3)),
      lift: 1,
      startsAt: at(16),
    });

    const res = await create(s, {
      endsAt: at(13, 0, addDays(DAY, 2)),
      lift: 1,
      startsAt: at(12, 0, addDays(DAY, 2)),
    });

    expect(first.status).toBe(201);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/^Lift 1 is blocked /);
    expect(res.body.message).toContain('16:00');
    expect(res.body.message).toContain('10:00');
    expect(res.body.message).not.toContain('24:00');
    expect(res.body.reason).toBe('time_block');
  });

  it('cuts a block over the spring clock change into 12, 23 and 6 hours', async () => {
    const s = await setting();

    const res = await create(s, {
      endsAt: at(6, 0, '2027-03-29'),
      lift: 1,
      startsAt: at(12, 0, '2027-03-27'),
    });

    expect(res.status).toBe(201);
    const spans = await segments(res.body.id);
    expect(
      spans.map((x) => (x.endsAt.getTime() - x.startsAt.getTime()) / 3_600_000),
    ).toEqual([12, 23, 6]);
  });

  it('ends eight identical saves at once with one block and seven 409s', async () => {
    const s = await setting();

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        create(s, { endsAt: at(11), lift: 2, startsAt: at(10) }),
      ),
    );

    const codes = results.map((r) => r.status).sort();
    expect(codes).toEqual([201, 409, 409, 409, 409, 409, 409, 409]);
    expect(await prisma.timeBlock.count()).toBe(1);
    expect(await prisma.bookingSegment.count({ where: { lift: 2 } })).toBe(1);
  });

  it('leaves no entry and no event behind a refused save', async () => {
    const s = await setting();
    await create(s, { endsAt: at(11), lift: 1, startsAt: at(10) });
    const mark = await outboxMark(prisma);
    const logged = await prisma.activityLog.count();

    const res = await create(s, { endsAt: at(11), lift: 1, startsAt: at(10) });

    expect(res.status).toBe(409);
    expect(await prisma.activityLog.count()).toBe(logged);
    expect(
      await prisma.outboxEvent.count({ where: { id: { gt: mark } } }),
    ).toBe(0);
  });
});

// @traces 427-FR-007
describe('changing a block, pushed', () => {
  async function blocked(body: object = {}) {
    const s = await setting();
    const res = await create(s, {
      endsAt: at(11, 30),
      lift: 2,
      mechanicId: s.mihai.id,
      note: 'Client',
      startsAt: at(10),
      ...body,
    });
    return {
      ...s,
      block: `${s.path}/${res.body.id}`,
      id: res.body.id as string,
    };
  }

  it('lets a block grow by a quarter hour over its own segment', async () => {
    const s = await blocked();

    const res = await send('patch', s.block, s.owner, { endsAt: at(11, 45) });

    expect(res.status).toBe(200);
    expect(res.body.endsAt).toBe(at(11, 45));
  });

  it('answers the same change twice with 200 and one entry only', async () => {
    const s = await blocked();
    const mark = await outboxMark(prisma);

    const first = await send('patch', s.block, s.owner, { endsAt: at(12) });
    const second = await send('patch', s.block, s.owner, { endsAt: at(12) });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    const updates = (await entries(s.id)).filter((e) => e.action === 'update');
    expect(updates).toHaveLength(1);
    expect(
      await prisma.outboxEvent.count({
        where: { id: { gt: mark }, kind: 'time_block.updated' },
      }),
    ).toBe(1);
  });

  it('writes nothing for a body that restates the stored values', async () => {
    const s = await blocked();
    const mark = await outboxMark(prisma);
    const before = (await entries(s.id)).length;

    const res = await send('patch', s.block, s.owner, {
      endsAt: at(11, 30),
      lift: 2,
      mechanicId: s.mihai.id,
      note: 'Client',
      startsAt: at(10),
    });

    expect(res.status).toBe(200);
    expect((await entries(s.id)).length).toBe(before);
    expect(
      await prisma.outboxEvent.count({
        where: { id: { gt: mark }, kind: 'time_block.updated' },
      }),
    ).toBe(0);
  });

  it('refuses to drop both the mechanic and the lift and leaves the block as it was', async () => {
    const s = await blocked();

    const res = await send('patch', s.block, s.owner, {
      lift: null,
      mechanicId: null,
    });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('nothing_to_block');
    expect(await segments(s.id)).toEqual([
      {
        endsAt: new Date(at(11, 30)),
        lift: 2,
        mechanicId: s.mihai.id,
        startsAt: new Date(at(10)),
      },
    ]);
  });

  it('drops the mechanic alone, rewriting the segment with none', async () => {
    const s = await blocked();

    const res = await send('patch', s.block, s.owner, { mechanicId: null });

    expect(res.status).toBe(200);
    expect(res.body.mechanic).toBeNull();
    expect(await segments(s.id)).toEqual([
      expect.objectContaining({ lift: 2, mechanicId: null }),
    ]);
  });

  it('empties the note with null and with spaces', async () => {
    const s = await blocked();

    const cleared = await send('patch', s.block, s.owner, { note: null });
    const spaced = await send('patch', s.block, s.owner, { note: '  ' });

    expect(cleared.body.note).toBeNull();
    expect(spaced.status).toBe(200);
    expect(spaced.body.note).toBeNull();
  });

  it('refuses a new end that is already past, 422 on endsAt', async () => {
    const s = await blocked();

    const res = await send('patch', s.block, s.owner, {
      endsAt: quarterAgo(4).toISOString(),
      startsAt: quarterAgo(8).toISOString(),
    });

    expect(res.status).toBe(422);
    expect(res.body.errors[0]).toMatchObject({ field: 'endsAt' });
  });

  it('refuses a past block with block_past before it looks at the body', async () => {
    const s = await setting();
    const past = await ended(s);

    const res = await send('patch', `${s.path}/${past.id}`, s.owner, {});

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('block_past');
  });

  it('answers a block that ended this very hour as past, and a block ending ahead as open', async () => {
    const s = await setting();
    const justEnded = await ended(s, {
      endsAt: new Date(Date.now() - 1_000),
      startsAt: new Date(Date.now() - 3_600_000),
    });
    const ahead = await ended(s, {
      endsAt: new Date(Date.now() + 3_600_000),
      lift: 2,
    });

    const gone = await send('delete', `${s.path}/${justEnded.id}`, s.owner);
    const live = await send('delete', `${s.path}/${ahead.id}`, s.owner);

    expect(gone.status).toBe(409);
    expect(live.status).toBe(204);
  });

  it('answers a second removal with 404 and writes one delete entry', async () => {
    const s = await blocked();

    const first = await send('delete', s.block, s.owner);
    const second = await send('delete', s.block, s.owner);

    expect(first.status).toBe(204);
    expect(second.status).toBe(404);
    expect(second.body.code).toBe('not_found');
    expect(
      (await entries(s.id)).filter((e) => e.action === 'delete'),
    ).toHaveLength(1);
  });

  it.each(['patch', 'delete'] as const)(
    'answers %s on a block id that is not a uuid with 404, not 500',
    async (method) => {
      const s = await setting();

      const res = await send(
        method,
        `${s.path}/not-a-uuid`,
        s.owner,
        method === 'patch' ? { note: 'x' } : undefined,
      );

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not_found');
    },
  );

  it('answers a change racing a removal with 200 and 404, or 404 and 404, never 500', async () => {
    const s = await blocked();

    const [change, removal] = await Promise.all([
      send('patch', s.block, s.owner, { endsAt: at(12) }),
      send('delete', s.block, s.owner),
    ]);

    expect([200, 404]).toContain(change.status);
    expect(removal.status).toBe(204);
    expect(await prisma.timeBlock.count()).toBe(0);
  });
});

// @traces 427-FR-003
describe('listing blocks, pushed', () => {
  it.each([
    ['from after to', `from=${addDays(DAY, 3)}&to=${DAY}`],
    ['an impossible day', 'from=2026-02-30'],
    ['a day with a time', `from=${DAY}T00:00:00Z`],
    ['a range of 32 days', `from=${DAY}&to=${addDays(DAY, 31)}`],
    ['an array of days', `from=${DAY}&from=${DAY}`],
  ])('answers %s with 400', async (_title, qs) => {
    const s = await setting();

    const res = await get(`${s.path}?${qs}`, s.owner);

    expect(res.status).toBe(400);
    // The API's ProblemFilter names a pipe's 400 validation_failed; this
    // test app has no filter, so only the service's own refusal names it.
    expect([undefined, 'validation_failed']).toContain(res.body.code);
  });

  it('answers the 31st day with 200 and lists a block on it', async () => {
    const s = await setting();
    const last = addDays(DAY, 30);
    await create(s, {
      endsAt: at(11, 0, last),
      lift: 1,
      startsAt: at(10, 0, last),
    });

    const res = await get(`${s.path}?from=${DAY}&to=${last}`, s.owner);

    expect(res.status).toBe(200);
    expect(res.body.blocks).toHaveLength(1);
  });

  it('lists nothing for an empty garage', async () => {
    const s = await setting();

    const res = await get(`${s.path}?from=${DAY}`, s.owner);

    expect(res.body).toEqual({ blocks: [], from: DAY, lifts: true, to: DAY });
  });

  it('lists a multi-day block on each day it touches and once only', async () => {
    const s = await setting();
    await create(s, {
      endsAt: at(10, 0, addDays(DAY, 3)),
      lift: 1,
      startsAt: at(16),
    });

    const res = await get(
      `${s.path}?from=${addDays(DAY, 1)}&to=${addDays(DAY, 2)}`,
      s.owner,
    );

    expect(res.body.blocks).toHaveLength(1);
  });

  it('leaves a block that ends exactly at midnight off the next day', async () => {
    const s = await setting();
    await create(s, {
      endsAt: at(0, 0, addDays(DAY, 1)),
      lift: 1,
      startsAt: at(22),
    });

    const next = await get(`${s.path}?from=${addDays(DAY, 1)}`, s.owner);

    expect(next.body.blocks).toEqual([]);
  });
});

// @traces 427-FR-011
describe('the schedule read with blocks, pushed', () => {
  const read = (s: Setting, auth: string, extra = '') =>
    get(`/garages/${s.garage.id}/schedule?from=${DAY}&to=${DAY}${extra}`, auth);

  async function withBlocks() {
    const s = await setting();
    await prisma.mechanic.update({
      data: { canMoveBookings: false },
      where: { id: s.mihai.id },
    });
    const mine = await create(s, {
      endsAt: at(11),
      mechanicId: s.mihai.id,
      note: 'al lui Mihai',
      startsAt: at(10),
    });
    const theirs = await create(s, {
      endsAt: at(13),
      mechanicId: s.answeringMechanic.id,
      note: 'al lui Fixer',
      startsAt: at(12),
    });
    const liftOnly = await create(s, {
      endsAt: at(15),
      lift: 2,
      note: 'doar elevator',
      startsAt: at(14),
    });
    return {
      ...s,
      liftOnly: liftOnly.body.id,
      mine: mine.body.id,
      theirs: theirs.body.id,
    };
  }
  const ids = (res: { body: { blocks: { id: string }[] } }) =>
    res.body.blocks.map((b) => b.id).sort();

  it('shows the owner and a receptionist every block with its note', async () => {
    const s = await withBlocks();

    const owner = await read(s, s.owner);
    const desk = await read(s, s.desk);

    const all = [s.liftOnly, s.mine, s.theirs].sort();
    expect(ids(owner)).toEqual(all);
    expect(ids(desk)).toEqual(all);
    expect(JSON.stringify(owner.body.blocks)).toContain('doar elevator');
  });

  it('shows a mechanic without the permission only her own card', async () => {
    const s = await withBlocks();

    const res = await read(s, bearer(s.plain, 'mechanic'));

    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([s.mine]);
    expect(JSON.stringify(res.body)).not.toContain('al lui Fixer');
    expect(JSON.stringify(res.body)).not.toContain('doar elevator');
  });

  it('shows a mechanic who may move bookings every block', async () => {
    const s = await withBlocks();
    await prisma.mechanic.update({
      data: { canMoveBookings: true },
      where: { id: s.mihai.id },
    });

    const res = await read(s, bearer(s.plain, 'mechanic'));

    expect(ids(res)).toEqual([s.liftOnly, s.mine, s.theirs].sort());
  });

  it('keeps a lift-only block out of a mechanicId filter, for the owner too', async () => {
    const s = await withBlocks();

    const res = await read(s, s.owner, `&mechanicId=${s.mihai.id}`);

    expect(ids(res)).toEqual([s.mine]);
  });

  it('keeps only that lift in a lift filter', async () => {
    const s = await withBlocks();

    const res = await read(s, s.owner, '&lift=2');

    expect(ids(res)).toEqual([s.liftOnly]);
  });

  it('answers blocks as an empty list for a garage with none', async () => {
    const s = await setting();

    const res = await read(s, s.owner);

    expect(res.status).toBe(200);
    expect(res.body.blocks).toEqual([]);
  });

  it('leaves the lift off every block once the lifts are switched off', async () => {
    const s = await withBlocks();
    await prisma.garageFeature.upsert({
      create: { enabled: false, garageId: s.garage.id, key: 'lift_schedule' },
      update: { enabled: false },
      where: { garageId_key: { garageId: s.garage.id, key: 'lift_schedule' } },
    });

    const res = await read(s, s.owner);

    expect(res.body.blocks.length).toBeGreaterThan(0);
    for (const block of res.body.blocks) {
      expect(block).not.toHaveProperty('lift');
    }
  });

  it('gives a driver, an admin and a visitor no block', async () => {
    const s = await withBlocks();
    const driver = await world.account('Andrei Marin', ['driver']);
    const admin = await world.account('Ana Admin', ['admin']);

    const asDriver = await read(s, bearer(driver, 'driver'));
    const asAdmin = await read(s, bearer(admin, 'admin'));
    const visitor = await get(`/garages/${s.garage.id}/schedule?from=${DAY}`);

    expect(asDriver.status).toBe(404);
    expect(asAdmin.status).toBe(404);
    expect(visitor.status).toBe(401);
    for (const res of [asDriver, asAdmin, visitor]) {
      expect(JSON.stringify(res.body)).not.toContain('doar elevator');
      expect(JSON.stringify(res.body)).not.toMatch(/blocat|blocked/i);
    }
  });
});

// @traces 427-FR-012
describe('removing a card with blocks, pushed', () => {
  it('refuses a block on a removed card with 422 on mechanicId', async () => {
    const s = await setting();
    // The card removal route is the garages module's; this app stores its
    // soft removal as that route does.
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
    expect(res.body.errors[0]).toMatchObject({ field: 'mechanicId' });
  });
});
