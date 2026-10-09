// @traces 374-FR-001
// @traces 374-FR-002
// @traces 374-FR-003
// @traces 374-FR-005
// @traces 374-FR-011
import { BadRequestException } from '@nestjs/common';

import { getSchedule } from './get-schedule';
import { caller, connect, context } from '../../fixtures.testing';
import { callTool, visibleTools } from '../../registry';

type Schedule = Awaited<
  ReturnType<ReturnType<typeof context>['garage']['schedule']['list']>
>;
type Entry = Schedule['entries'][number];

const entry = (id: string, more: Partial<Entry> = {}): Entry => ({
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
});

const vlad = { id: 'mechanic-1', name: 'Vlad Stan' };

const scheduleOf = (answer: Partial<Schedule> = {}) =>
  jest.fn(async () => ({
    entries: [] as Entry[],
    from: '2026-10-09',
    lifts: true,
    to: '2026-10-09',
    ...answer,
  }));

const call = (
  args: unknown,
  list = scheduleOf(),
  language: 'ro' | 'en' = 'ro',
) =>
  callTool(
    [getSchedule],
    caller({ language, roles: ['garage'] }, ['motorfix.read']),
    context({ garage: { schedule: { list } } }),
    'get_schedule',
    args,
  );

describe('get_schedule', () => {
  it('is a read held by the owner and the receptionist only', async () => {
    expect(getSchedule.acts).toBe(false);
    expect(getSchedule.annotations).toEqual({
      destructiveHint: false,
      readOnlyHint: true,
    });
    for (const [shape, shown] of [
      [{ roles: ['garage'] }, true],
      [{ roles: ['receptionist'] }, true],
      [{ mechanic: { canAnswerQuotes: true }, roles: ['mechanic'] }, false],
      [{ roles: ['driver'] }, false],
    ] as const) {
      const listed = await visibleTools(
        [getSchedule],
        caller({ ...shape, roles: [...shape.roles] }, ['motorfix.read']),
        context(),
      );
      expect(listed.map((t) => t.name)).toEqual(shown ? ['get_schedule'] : []);
    }
  });

  it('passes the days and filters to the schedule read', async () => {
    const list = scheduleOf();
    await call(
      {
        from: '2026-10-12',
        lift: 2,
        mechanicId: '6f1c2a51-8a3c-4c1e-9d55-0f7a2c1b3e4d',
        to: '2026-10-14',
      },
      list,
    );
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'garage' }),
      {
        from: '2026-10-12',
        lift: 2,
        mechanicId: '6f1c2a51-8a3c-4c1e-9d55-0f7a2c1b3e4d',
        to: '2026-10-14',
      },
    );
  });

  it.each([
    ['a day that is not a date', { from: '2026-02-30' }],
    ['a day in another format', { from: '09.10.2026' }],
    ['a lift of zero', { lift: 0 }],
    ['a lift that is not whole', { lift: 1.5 }],
    ['a mechanic id that is not a uuid', { mechanicId: 'Costel' }],
  ])('refuses %s with validation', async (_case, args) => {
    const list = scheduleOf();
    const result = await call(args, list);
    expect(result.structuredContent).toMatchObject({ code: 'validation' });
    expect(list).not.toHaveBeenCalled();
  });

  it('answers the read’s refusal of a range or a lift as validation', async () => {
    const list = jest.fn(async () => {
      throw new BadRequestException({
        code: 'validation',
        message: 'At most 7 days',
      });
    });
    const result = await call({ from: '2026-10-01', to: '2026-10-20' }, list);
    expect(result.structuredContent).toMatchObject({ code: 'validation' });
  });

  it('names the group with no mechanic in the account’s language', async () => {
    const list = () => scheduleOf({ entries: [entry('b-1')] });
    const nameOf = (r: Awaited<ReturnType<typeof call>>) =>
      (r.structuredContent as { byMechanic: { name: string }[] }).byMechanic[0]
        .name;
    expect(nameOf(await call({}, list(), 'ro'))).toBe('Fără mecanic');
    expect(nameOf(await call({}, list(), 'en'))).toBe('No mechanic');
  });

  it('groups the entries by mechanic and by lift, by id only', async () => {
    const list = scheduleOf({
      entries: [
        entry('b-1', { lift: 2, mechanic: vlad }),
        entry('b-2', { lift: 1 }),
        entry('b-3', { lift: 2, mechanic: vlad }),
      ],
    });
    const result = await call({}, list);
    expect(result.structuredContent).toMatchObject({
      byLift: [
        { bookingIds: ['b-1', 'b-3'], lift: 2 },
        { bookingIds: ['b-2'], lift: 1 },
      ],
      byMechanic: [
        { bookingIds: ['b-1', 'b-3'], id: 'mechanic-1', name: 'Vlad Stan' },
        { bookingIds: ['b-2'], id: null, name: 'Fără mecanic' },
      ],
      lifts: true,
    });
    expect(
      (result.structuredContent as { entries: Entry[] }).entries.map(
        (e) => e.id,
      ),
    ).toEqual(['b-1', 'b-2', 'b-3']);
  });

  it('groups a booking with no lift yet under a null lift when the garage schedules lifts', async () => {
    const list = scheduleOf({
      entries: [entry('b-1', { lift: 2 }), entry('b-2', { lift: null })],
    });
    const result = await call({}, list);
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      byLift: [
        { bookingIds: ['b-1'], lift: 2 },
        { bookingIds: ['b-2'], lift: null },
      ],
    });
  });

  it('groups by mechanic only when the garage schedules without lifts', async () => {
    const { lift: _lift, ...unlifted } = entry('b-1', { mechanic: vlad });
    const list = scheduleOf({ entries: [unlifted as Entry], lifts: false });
    const result = await call({}, list);
    expect(result.structuredContent).not.toHaveProperty('byLift');
    expect(JSON.stringify(result.structuredContent)).not.toMatch(/"lift"/);
    expect(result.structuredContent).toMatchObject({
      byMechanic: [{ bookingIds: ['b-1'], id: 'mechanic-1' }],
    });
  });

  it('answers an empty schedule with a plain sentence in the account’s language', async () => {
    const ro = await call({}, scheduleOf(), 'ro');
    const en = await call({}, scheduleOf(), 'en');
    const noteOf = (r: typeof ro) =>
      (r.structuredContent as { note: string }).note;
    expect(ro.isError).toBeFalsy();
    expect(noteOf(ro).length).toBeGreaterThan(0);
    expect(noteOf(ro)).not.toBe(noteOf(en));
  });

  it('adds no note when there are bookings', async () => {
    const result = await call({}, scheduleOf({ entries: [entry('b-1')] }));
    expect(result.structuredContent).not.toHaveProperty('note');
  });
});

describe('get_schedule output schema', () => {
  it('declares one its answer fits, as the client checks it', async () => {
    const client = await connect(
      [getSchedule],
      caller({ roles: ['garage'] }, ['motorfix.read']),
      context({
        garage: {
          schedule: {
            list: scheduleOf({
              entries: [
                entry('b1', { mechanic: vlad }),
                entry('b2', {
                  confirmBy: '2026-10-09T05:00:00.000Z',
                  minutesLeft: 30,
                  state: 'awaiting_confirmation',
                }),
              ],
            }),
          },
        },
      }),
    );
    const { tools } = await client.listTools();
    expect(tools[0].outputSchema).toBeDefined();
    const answer = await client.callTool({
      arguments: {},
      name: 'get_schedule',
    });
    expect(answer.isError).toBeFalsy();
  });
});
