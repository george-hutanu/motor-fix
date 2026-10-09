import { BadRequestException } from '@nestjs/common';

import { getSchedule } from './get-schedule';
import { caller, connect, context } from '../../fixtures.testing';
import { callTool, visibleTools } from '../../registry';

type Schedule = Awaited<
  ReturnType<ReturnType<typeof context>['garage']['schedule']['list']>
>;
type Entry = Schedule['entries'][number];

const entry = (id: string, more: Record<string, unknown> = {}): Entry =>
  ({
    car: { brand: 'Dacia', model: 'Logan', year: 2019 },
    confirmBy: null,
    durationMinutes: 90,
    id,
    jobs: ['Schimb ulei'],
    lift: 1,
    mechanic: null,
    minutesLeft: null,
    startsAt: '2026-10-09T06:00:00.000Z',
    state: 'confirmed',
    ...more,
  }) as Entry;

const scheduleOf = (answer: Partial<Schedule> = {}) =>
  jest.fn(async () => ({
    entries: [] as Entry[],
    from: '2026-10-09',
    lifts: true,
    to: '2026-10-09',
    ...answer,
  }));

const MECHANIC = '6f1c2a51-8a3c-4c1e-9d55-0f7a2c1b3e4d';

const call = (
  args: unknown,
  list = scheduleOf(),
  who = caller({ roles: ['garage'] }, ['motorfix.read']),
) =>
  callTool(
    [getSchedule],
    who,
    context({ garage: { schedule: { list } } }),
    'get_schedule',
    args,
  );

describe('get_schedule under hostile calls', () => {
  it.each([
    ['only the act scope', ['motorfix.act']],
    ['no scope at all', []],
  ] as const)('is unlisted and refused with %s', async (_c, scopes) => {
    const list = scheduleOf();
    const who = caller({ roles: ['garage'] }, [...scopes]);
    expect(await visibleTools([getSchedule], who, context())).toEqual([]);
    const result = await call({}, list, who);
    expect(result.structuredContent).toMatchObject({
      code: 'assistant_read_off',
    });
    expect(list).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a mechanic who may answer quotes',
      { mechanic: { canAnswerQuotes: true }, roles: ['mechanic'] },
    ],
    ['a driver', { roles: ['driver'] }],
    ['no role', { roles: [] }],
  ] as const)('answers not_found to %s', async (_c, shape) => {
    const list = scheduleOf();
    const result = await call(
      {},
      list,
      caller({ ...shape, roles: [...shape.roles] }, ['motorfix.read']),
    );
    expect(result.structuredContent).toMatchObject({ code: 'not_found' });
    expect(list).not.toHaveBeenCalled();
  });

  it('stays listed when day sheets or lifts are switched off', async () => {
    const listed = await visibleTools(
      [getSchedule],
      caller({ roles: ['garage'] }, ['motorfix.read']),
      context({ features: { day_sheets: false, lift_schedule: false } }),
    );
    expect(listed.map((t) => t.name)).toEqual(['get_schedule']);
  });

  it.each([
    ['a day with a time', { from: '2026-10-09T00:00:00Z' }],
    ['a day with a leading space', { from: ' 2026-10-09' }],
    ['an unpadded day', { from: '2026-1-9' }],
    ['a number day', { from: 20261009 }],
    ['an empty day', { from: '' }],
    ['a null day', { from: null }],
    ['a bad to', { to: '2026-13-01' }],
    ['a non-leap 29 February', { to: '2026-02-29' }],
    ['a lift of zero', { lift: 0 }],
    ['a negative lift', { lift: -1 }],
    ['a lift as text', { lift: '2' }],
    ['a lift that is NaN-like', { lift: 'NaN' }],
    ['an infinite lift', { lift: Number.POSITIVE_INFINITY }],
    ['an empty mechanic id', { mechanicId: '' }],
    ['a null mechanic id', { mechanicId: null }],
    ['an upper-case non-uuid', { mechanicId: 'COSTEL' }],
    ['a uuid with a trailing space', { mechanicId: `${MECHANIC} ` }],
  ])('refuses %s with validation', async (_c, args) => {
    const list = scheduleOf();
    const result = await call(args, list);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: 'validation' });
    expect(list).not.toHaveBeenCalled();
  });

  it('hands over exactly seven days and a lift of one', async () => {
    const list = scheduleOf();
    await call({ from: '2026-10-01', lift: 1, to: '2026-10-07' }, list);
    expect(list).toHaveBeenCalledWith(expect.anything(), {
      from: '2026-10-01',
      lift: 1,
      to: '2026-10-07',
    });
  });

  it.each([
    ['a span of eight days', { from: '2026-10-01', to: '2026-10-08' }],
    [
      'a range that ends before it starts',
      { from: '2026-10-05', to: '2026-10-04' },
    ],
    ['a lift while lifts are off', { lift: 2 }],
  ])('relays the read’s refusal of %s as validation', async (_c, args) => {
    const list = jest.fn(async () => {
      throw new BadRequestException({ code: 'validation', message: 'no' });
    });
    const result = await call(args, list);
    expect(result.structuredContent).toMatchObject({ code: 'validation' });
  });

  it('never forwards a garage id from the input', async () => {
    const list = scheduleOf();
    await call({ garageId: 'garage-2' }, list);
    expect(list).toHaveBeenCalledWith(expect.anything(), {});
  });

  it('answers a database outage with service_unavailable', async () => {
    const down = Object.assign(new Error('x'), {
      name: 'PrismaClientInitializationError',
    });
    const result = await call(
      {},
      jest.fn(() => Promise.reject(down)),
    );
    expect(result.structuredContent).toMatchObject({
      code: 'service_unavailable',
    });
  });
});

describe('get_schedule answers', () => {
  it('leaks no plate and no phone even when the read carries them', async () => {
    const result = await call(
      {},
      scheduleOf({
        entries: [
          entry('b-1', {
            car: {
              brand: 'Dacia',
              model: 'Logan',
              plate: 'B-123-ABC',
              year: 2019,
            },
            driver: { phone: '+40712345678' },
          }),
        ],
      }),
    );
    const body = JSON.stringify(result);
    expect(body).not.toContain('B-123-ABC');
    expect(body).not.toContain('+40712345678');
  });

  it('puts an unassigned booking under one unassigned group and repeats no id', async () => {
    const result = await call(
      {},
      scheduleOf({
        entries: [entry('b-1'), entry('b-2'), entry('b-3')],
      }),
    );
    const { byMechanic, byLift } = result.structuredContent as {
      byMechanic: { id: string | null; bookingIds: string[] }[];
      byLift: { lift: number; bookingIds: string[] }[];
    };
    expect(byMechanic).toEqual([
      { bookingIds: ['b-1', 'b-2', 'b-3'], id: null, name: 'unassigned' },
    ]);
    expect(byLift).toEqual([{ bookingIds: ['b-1', 'b-2', 'b-3'], lift: 1 }]);
  });

  it('keeps ten thousand bookings once each in the entries and once each in each grouping', async () => {
    const entries = Array.from({ length: 10_000 }, (_v, i) =>
      entry(`b-${i}`, {
        lift: (i % 4) + 1,
        mechanic: i % 3 ? { id: `m-${i % 3}`, name: `M${i % 3}` } : null,
      }),
    );
    const result = await call({}, scheduleOf({ entries }));
    const out = result.structuredContent as {
      entries: unknown[];
      byMechanic: { bookingIds: string[] }[];
      byLift: { bookingIds: string[] }[];
    };
    expect(out.entries).toHaveLength(10_000);
    for (const groups of [out.byMechanic, out.byLift]) {
      const ids = groups.flatMap((g) => g.bookingIds);
      expect(ids).toHaveLength(10_000);
      expect(new Set(ids).size).toBe(10_000);
    }
  });

  it('adds the note for an empty period in each language and none for a full one', async () => {
    const ro = await call({});
    const en = await call(
      {},
      undefined,
      caller({ language: 'en', roles: ['garage'] }, ['motorfix.read']),
    );
    expect((ro.structuredContent as { note: string }).note).toMatch(/\S/);
    expect((en.structuredContent as { note: string }).note).not.toBe(
      (ro.structuredContent as { note: string }).note,
    );
    expect(ro.structuredContent).toMatchObject({ byMechanic: [], entries: [] });
  });

  it('fits its declared schema for every state, with and without lifts', async () => {
    const states = [
      'confirmed',
      'completed',
      'no_show',
      'awaiting_confirmation',
    ] as const;
    const entries = states.map((state, i) =>
      entry(`b-${i}`, {
        confirmBy:
          state === 'awaiting_confirmation' ? '2026-10-09T05:00:00.000Z' : null,
        mechanic: i % 2 ? { id: 'm-1', name: 'Vlad Stan' } : null,
        minutesLeft: state === 'awaiting_confirmation' ? 0 : null,
        state,
      }),
    );
    for (const lifts of [true, false]) {
      const client = await connect(
        [getSchedule],
        caller({ roles: ['receptionist'] }, ['motorfix.read']),
        context({
          garage: {
            schedule: {
              list: scheduleOf({
                entries: lifts
                  ? entries
                  : entries.map(({ lift: _l, ...rest }) => rest as Entry),
                lifts,
              }),
            },
          },
        }),
      );
      const answer = await client.callTool({
        arguments: {},
        name: 'get_schedule',
      });
      expect(answer.isError).toBeFalsy();
    }
  });

  it('fits its declared schema for an empty period and for a refusal', async () => {
    const client = await connect(
      [getSchedule],
      caller({ roles: ['garage'] }, ['motorfix.read']),
      context({
        garage: {
          schedule: {
            list: jest
              .fn()
              .mockResolvedValueOnce({
                entries: [],
                from: '2026-10-09',
                lifts: false,
                to: '2026-10-09',
              })
              .mockRejectedValueOnce(
                new BadRequestException({ code: 'validation', message: 'x' }),
              ),
          },
        },
      }),
    );
    // An assistant lists the tools first, and from then on its client checks
    // every answer of the tool against the declared output.
    await client.listTools();
    const empty = await client.callTool({
      arguments: {},
      name: 'get_schedule',
    });
    const bad = await client.callTool({
      arguments: { from: '2026-10-01', to: '2026-10-30' },
      name: 'get_schedule',
    });
    expect(empty.isError).toBeFalsy();
    expect(bad.isError).toBe(true);
    expect(
      JSON.parse((bad.content as { text: string }[])[0].text),
    ).toMatchObject({ code: 'validation' });
  });
});
