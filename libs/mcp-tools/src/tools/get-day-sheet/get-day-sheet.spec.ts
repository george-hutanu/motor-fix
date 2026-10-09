// @traces 374-FR-001
// @traces 374-FR-002
// @traces 374-FR-003
// @traces 374-FR-006
// @traces 374-FR-011
import { NotFoundException } from '@nestjs/common';

import { getDaySheet } from './get-day-sheet';
import { caller, context } from '../../fixtures.testing';
import { callTool, visibleTools } from '../../registry';

type Sheet = Awaited<
  ReturnType<ReturnType<typeof context>['garage']['daySheet']['get']>
>;

const costel = { id: 'mechanic-1', name: 'Costel Ionescu' };

const sheetOf = (answer: Partial<Sheet> = {}) =>
  jest.fn(async () => ({
    day: '2026-10-10',
    entries: [] as Sheet['entries'],
    jobCount: 0,
    mechanic: costel,
    totalHours: 0,
    ...answer,
  }));

const call = (
  args: unknown,
  get = sheetOf(),
  options: { language?: 'ro' | 'en'; daySheets?: boolean } = {},
) =>
  callTool(
    [getDaySheet],
    caller({ language: options.language ?? 'ro', roles: ['garage'] }, [
      'motorfix.read',
    ]),
    context({
      features: { day_sheets: options.daySheets ?? true },
      garage: { daySheet: { get } },
    }),
    'get_day_sheet',
    args,
  );

describe('get_day_sheet', () => {
  it('is a read held by the owner and the receptionist only', async () => {
    expect(getDaySheet.acts).toBe(false);
    expect(getDaySheet.annotations).toEqual({
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
        [getDaySheet],
        caller({ ...shape, roles: [...shape.roles] }, ['motorfix.read']),
        context(),
      );
      expect(listed.map((t) => t.name)).toEqual(shown ? ['get_day_sheet'] : []);
    }
  });

  it('is unlisted and answers not_found when the garage turned day sheets off', async () => {
    const listed = await visibleTools(
      [getDaySheet],
      caller({ roles: ['garage'] }, ['motorfix.read']),
      context({ features: { day_sheets: false } }),
    );
    const get = sheetOf();
    const result = await call({ mechanic: 'Costel' }, get, {
      daySheets: false,
    });
    expect(listed).toEqual([]);
    expect(result.structuredContent).toMatchObject({ code: 'not_found' });
    expect(get).not.toHaveBeenCalled();
  });

  it('passes the mechanic and the day to the day-sheet read', async () => {
    const get = sheetOf();
    await call({ day: '2026-10-10', mechanic: 'Costel' }, get);
    await call({ mechanic: 'Costel' }, get);
    expect(get).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ role: 'garage', via: 'assistant' }),
      { day: '2026-10-10', mechanic: 'Costel' },
    );
    expect(get).toHaveBeenNthCalledWith(2, expect.anything(), {
      mechanic: 'Costel',
    });
  });

  it.each([
    ['no mechanic', {}],
    ['an empty mechanic', { mechanic: '' }],
    ['a day that is not a date', { day: 'mâine', mechanic: 'Costel' }],
  ])('refuses %s with validation', async (_case, args) => {
    const get = sheetOf();
    const result = await call(args, get);
    expect(result.structuredContent).toMatchObject({ code: 'validation' });
    expect(get).not.toHaveBeenCalled();
  });

  it('answers the sheet with the customer’s note as user text', async () => {
    const entries = [
      {
        car: { brand: 'Dacia', model: 'Logan', year: 2019 },
        durationMinutes: 90,
        id: 'b-1',
        jobs: ['Schimb ulei'],
        note: 'Sună-mă înainte',
        startsAt: '2026-10-10T06:00:00.000Z',
        state: 'confirmed' as const,
      },
      {
        car: { brand: 'Mini', model: 'Cooper S', year: 2019 },
        durationMinutes: 60,
        id: 'b-2',
        jobs: [],
        note: null,
        startsAt: '2026-10-10T08:00:00.000Z',
        state: 'completed' as const,
      },
    ];
    const result = await call(
      { mechanic: 'Costel' },
      sheetOf({ entries, jobCount: 2, totalHours: 2.5 }),
    );
    expect(result.structuredContent).toEqual({
      day: '2026-10-10',
      entries: [
        {
          ...entries[0],
          note: {
            author: 'driver',
            kind: 'user_text',
            text: 'Sună-mă înainte',
          },
        },
        entries[1],
      ],
      jobCount: 2,
      mechanic: costel,
      totalHours: 2.5,
    });
  });

  it('lists the garage’s mechanics when the name matches none or two', async () => {
    const mechanics = [costel, { id: 'mechanic-2', name: 'Costel Pop' }];
    const get = jest.fn(async () => {
      throw new NotFoundException({
        code: 'mechanic_not_found',
        mechanics,
        message: 'No single mechanic has that name',
      });
    });
    const result = await call({ mechanic: 'Costel' }, get, { language: 'en' });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: 'mechanic_not_found',
      mechanics,
    });
  });

  it('answers an empty sheet with a plain sentence in the account’s language', async () => {
    const ro = await call({ mechanic: 'Costel' }, sheetOf());
    const en = await call({ mechanic: 'Costel' }, sheetOf(), {
      language: 'en',
    });
    const noteOf = (r: typeof ro) =>
      (r.structuredContent as { note: string }).note;
    expect(ro.isError).toBeFalsy();
    expect(noteOf(ro).length).toBeGreaterThan(0);
    expect(noteOf(ro)).not.toBe(noteOf(en));
  });
});
