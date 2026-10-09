import { BadRequestException } from '@nestjs/common';

import { getStats } from './get-stats';
import { caller, connect, context } from '../../fixtures.testing';
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

const call = (
  args: unknown,
  get = figuresOf(),
  who = caller({ roles: ['garage'] }, ['motorfix.read']),
) =>
  callTool(
    [getStats],
    who,
    context({ garage: { figures: { get } } }),
    'get_stats',
    args,
  );

describe('get_stats under hostile calls', () => {
  it.each([
    ['only the act scope', ['motorfix.act']],
    ['no scope at all', []],
  ] as const)('is unlisted and refused with %s', async (_c, scopes) => {
    const get = figuresOf();
    const who = caller({ roles: ['garage'] }, [...scopes]);
    expect(await visibleTools([getStats], who, context())).toEqual([]);
    const result = await call({}, get, who);
    expect(result.structuredContent).toMatchObject({
      code: 'assistant_read_off',
    });
    expect(get).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a mechanic who may answer quotes',
      { mechanic: { canAnswerQuotes: true }, roles: ['mechanic'] },
    ],
    ['a driver', { roles: ['driver'] }],
    ['no role', { roles: [] }],
  ] as const)('answers not_found to %s', async (_c, shape) => {
    const get = figuresOf();
    const result = await call(
      {},
      get,
      caller({ ...shape, roles: [...shape.roles] }, ['motorfix.read']),
    );
    expect(result.structuredContent).toMatchObject({ code: 'not_found' });
    expect(get).not.toHaveBeenCalled();
  });

  it('is listed to a receptionist and stays listed with every garage feature off', async () => {
    const listed = await visibleTools(
      [getStats],
      caller({ roles: ['receptionist'] }, ['motorfix.read']),
      context({ features: { day_sheets: false, lift_schedule: false } }),
    );
    expect(listed.map((t) => t.name)).toEqual(['get_stats']);
  });

  it.each([
    ['an upper-case period', { period: 'WEEK' }],
    ['an empty period', { period: '' }],
    ['a null period', { period: null }],
    ['a day with a time', { from: '2026-10-01T00:00:00Z', to: '2026-10-02' }],
    ['a non-leap 29 February', { from: '2026-02-29', to: '2026-03-02' }],
    ['a number day', { from: 20261001, to: 20261002 }],
    ['a comparison given as text', { compareWithPrevious: 'true' }],
    ['a comparison given as a number', { compareWithPrevious: 1 }],
    ['a null comparison', { compareWithPrevious: null }],
  ])('refuses %s with validation', async (_c, args) => {
    const get = figuresOf();
    const result = await call(args, get);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: 'validation' });
    expect(get).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a period beside from and to',
      { from: '2026-10-01', period: 'week', to: '2026-10-03' },
    ],
    ['a from without a to', { from: '2026-10-01' }],
    ['a to without a from', { to: '2026-10-03' }],
    ['a period beside a lone from', { from: '2026-10-01', period: 'month' }],
  ])('refuses %s with validation', async (_c, args) => {
    const get = jest.fn(async () => {
      throw new BadRequestException({ code: 'validation', message: 'no' });
    });
    const result = await call(args, get);
    expect(result.structuredContent).toMatchObject({ code: 'validation' });
  });

  it.each([
    ['a to before the from', { from: '2026-10-05', to: '2026-10-04' }],
    ['a span of 367 days', { from: '2025-01-01', to: '2026-01-02' }],
  ])('relays the read’s refusal of %s as validation', async (_c, args) => {
    const get = jest.fn(async () => {
      throw new BadRequestException({ code: 'validation', message: 'no' });
    });
    const result = await call(args, get);
    expect(result.structuredContent).toMatchObject({ code: 'validation' });
  });

  it('hands over a one-day range and the longest allowed range untouched', async () => {
    const get = figuresOf();
    await call({ from: '2026-10-05', to: '2026-10-05' }, get);
    await call({ from: '2025-01-01', to: '2026-01-01' }, get);
    expect(get).toHaveBeenNthCalledWith(1, expect.anything(), {
      from: '2026-10-05',
      to: '2026-10-05',
    });
    expect(get).toHaveBeenNthCalledWith(2, expect.anything(), {
      from: '2025-01-01',
      to: '2026-01-01',
    });
  });

  it('never forwards a garage id from the input', async () => {
    const get = figuresOf();
    await call({ garageId: 'garage-2', period: 'week' }, get);
    expect(get).toHaveBeenCalledWith(expect.anything(), { period: 'week' });
  });

  it('refuses in the account’s language', async () => {
    const ro = await call({ period: 'year' });
    const en = await call(
      { period: 'year' },
      undefined,
      caller({ language: 'en', roles: ['garage'] }, ['motorfix.read']),
    );
    expect((ro.structuredContent as { message: string }).message).not.toBe(
      (en.structuredContent as { message: string }).message,
    );
  });

  it('answers a database outage with service_unavailable', async () => {
    const down = Object.assign(new Error('x'), {
      code: 'P1017',
      name: 'PrismaClientKnownRequestError',
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

describe('get_stats answers', () => {
  it('adds the note only when every count of the current period is zero', async () => {
    for (const key of [
      'requests',
      'quotesSent',
      'quotesWon',
      'bookings',
      'estimatedWorkBani',
    ] as const) {
      const result = await call(
        {},
        figuresOf({ current: { ...ZERO, [key]: 1 } }),
      );
      expect(result.structuredContent).not.toHaveProperty('note');
    }
  });

  it('adds the note for a quiet current period even when the previous one was busy', async () => {
    const result = await call(
      { compareWithPrevious: true },
      figuresOf({
        previous: {
          ...ZERO,
          period: { from: '2026-09-28', to: '2026-10-04' },
          requests: 9,
        },
      }),
    );
    expect((result.structuredContent as { note: string }).note).toMatch(/\S/);
  });

  it('adds the note in each language', async () => {
    const ro = await call({});
    const en = await call(
      {},
      undefined,
      caller({ language: 'en', roles: ['garage'] }, ['motorfix.read']),
    );
    expect((ro.structuredContent as { note: string }).note).not.toBe(
      (en.structuredContent as { note: string }).note,
    );
  });

  it('keeps a null response time null and a zero response time zero', async () => {
    const quiet = await call({}, figuresOf());
    const instant = await call(
      {},
      figuresOf({ current: { ...ZERO, requests: 1, responseTimeMinutes: 0 } }),
    );
    expect(quiet.structuredContent).toMatchObject({
      current: { responseTimeMinutes: null },
    });
    expect(instant.structuredContent).toMatchObject({
      current: { responseTimeMinutes: 0 },
    });
  });

  it('adds no previous block unless it was asked for and the read gave one', async () => {
    const result = await call({}, figuresOf());
    expect(result.structuredContent).not.toHaveProperty('previous');
  });

  it('exposes nothing beyond the declared figures', async () => {
    const result = await call(
      {},
      figuresOf({
        current: {
          ...ZERO,
          peerAverage: 7,
          phone: '+40712345678',
          requests: 2,
        } as never,
      }),
    );
    expect(
      Object.keys(
        (result.structuredContent as { current: object }).current,
      ).sort(),
    ).toEqual(Object.keys(ZERO).sort());
  });

  it('fits its declared schema with large figures and a null response time', async () => {
    const client = await connect(
      [getStats],
      caller({ roles: ['receptionist'] }, ['motorfix.read']),
      context({
        garage: {
          figures: {
            get: figuresOf({
              current: {
                ...ZERO,
                estimatedWorkBani: Number.MAX_SAFE_INTEGER,
                requests: 1_000_000,
              },
              previous: {
                ...ZERO,
                period: { from: '2025-01-01', to: '2025-12-31' },
                responseTimeMinutes: 1,
              },
            }),
          },
        },
      }),
    );
    const answer = await client.callTool({
      arguments: {
        compareWithPrevious: true,
        from: '2026-01-01',
        to: '2026-12-31',
      },
      name: 'get_stats',
    });
    expect(answer.isError).toBeFalsy();
  });

  it('fits its declared schema for a quiet period', async () => {
    const client = await connect(
      [getStats],
      caller({ language: 'en', roles: ['garage'] }, ['motorfix.read']),
      context({ garage: { figures: { get: figuresOf() } } }),
    );
    const answer = await client.callTool({ arguments: {}, name: 'get_stats' });
    expect(answer.isError).toBeFalsy();
  });
});
