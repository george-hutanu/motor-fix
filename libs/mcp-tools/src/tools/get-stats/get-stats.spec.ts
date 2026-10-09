// @traces 374-FR-001
// @traces 374-FR-002
// @traces 374-FR-007
// @traces 374-FR-011
import { getStats } from './get-stats';
import { caller, context } from '../../fixtures.testing';
import { callTool, visibleTools } from '../../registry';

type Figures = Awaited<
  ReturnType<ReturnType<typeof context>['garage']['figures']['get']>
>;

const ZERO = {
  bookings: 0,
  estimatedWorkBani: 0,
  quotesSent: 0,
  quotesWon: 0,
  requests: 0,
  responseTimeMinutes: null,
};

const figuresOf = (answer: Partial<Figures> = {}) =>
  jest.fn(async () => ({
    current: ZERO,
    period: { from: '2026-10-05', to: '2026-10-11' },
    ...answer,
  }));

const call = (args: unknown, get = figuresOf(), language: 'ro' | 'en' = 'ro') =>
  callTool(
    [getStats],
    caller({ language, roles: ['garage'] }, ['motorfix.read']),
    context({ garage: { figures: { get } } }),
    'get_stats',
    args,
  );

describe('get_stats', () => {
  it('is a read held by the owner and the receptionist only', async () => {
    expect(getStats.acts).toBe(false);
    expect(getStats.annotations).toEqual({
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
        [getStats],
        caller({ ...shape, roles: [...shape.roles] }, ['motorfix.read']),
        context(),
      );
      expect(listed.map((t) => t.name)).toEqual(shown ? ['get_stats'] : []);
    }
  });

  it('passes the period and the comparison to the figures read', async () => {
    const get = figuresOf();
    await call({ compareWithPrevious: true, period: 'month' }, get);
    await call({ from: '2026-10-01', to: '2026-10-03' }, get);
    expect(get).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ role: 'garage', via: 'assistant' }),
      { compareWithPrevious: true, period: 'month' },
    );
    expect(get).toHaveBeenNthCalledWith(2, expect.anything(), {
      from: '2026-10-01',
      to: '2026-10-03',
    });
  });

  it.each([
    ['a period it does not know', { period: 'year' }],
    ['a day that is not a date', { from: '2026-13-01', to: '2026-13-02' }],
    ['a comparison that is not a yes or no', { compareWithPrevious: 'da' }],
  ])('refuses %s with validation', async (_case, args) => {
    const get = figuresOf();
    const result = await call(args, get);
    expect(result.structuredContent).toMatchObject({ code: 'validation' });
    expect(get).not.toHaveBeenCalled();
  });

  it('answers the garage’s numbers beside the previous period', async () => {
    const current = {
      bookings: 5,
      estimatedWorkBani: 184_000,
      quotesSent: 9,
      quotesWon: 4,
      requests: 12,
      responseTimeMinutes: 42,
    };
    const previous = {
      ...ZERO,
      period: { from: '2026-09-28', to: '2026-10-04' },
      requests: 3,
    };
    const result = await call(
      { compareWithPrevious: true },
      figuresOf({ current, previous }),
    );
    expect(result.structuredContent).toEqual({
      current,
      period: { from: '2026-10-05', to: '2026-10-11' },
      previous,
    });
  });

  it('answers a quiet period with zeros and a plain sentence in the account’s language', async () => {
    const ro = await call({}, figuresOf(), 'ro');
    const en = await call({}, figuresOf(), 'en');
    const answer = (r: typeof ro) =>
      r.structuredContent as { current: unknown; note: string };
    expect(ro.isError).toBeFalsy();
    expect(answer(ro).current).toEqual(ZERO);
    expect(answer(ro).note.length).toBeGreaterThan(0);
    expect(answer(ro).note).not.toBe(answer(en).note);
  });
});
