import { catalogue } from './catalogue';
import { caller, context, fixtureTools } from './fixtures.testing';
import { callTool, USER_TEXT_NOTICE, visibleTools } from './registry';

const GARAGE_READS = [
  'get_day_sheet',
  'get_schedule',
  'get_stats',
  'list_quote_requests',
];

const GARAGE_ACTS = ['decline_quote_request'];

// What an assistant must never be able to do for a person.
const FORBIDDEN = [
  /pay(ment)?s?\b|card|invoice|refund|charge/i,
  /password|passcode/i,
  /e-?mail/i,
  /delet(e|ion)|remove.*account|close.*account/i,
  /legal|document|certificate|upload/i,
  /media|photo|image|video|audio|file/i,
  /live|stream|broadcast/i,
];

describe('catalogue', () => {
  // @traces 365-FR-007
  // @traces 374-FR-001
  // @traces 345-FR-017
  it('ships get_my_account, the four garage reads and decline_quote_request, the one act', () => {
    expect(catalogue.map((t) => t.name).sort()).toEqual(
      ['get_my_account', ...GARAGE_READS, ...GARAGE_ACTS].sort(),
    );
    for (const tool of catalogue) {
      const acts = GARAGE_ACTS.includes(tool.name);
      expect(tool.acts).toBe(acts);
      expect(tool.annotations).toMatchObject({
        destructiveHint: acts,
        readOnlyHint: !acts,
      });
    }
  });

  // @traces 374-FR-002
  it('lists the garage reads beside the driver’s tools to a person holding both roles, each read run for their garage', async () => {
    const who = caller({ garageId: 'garage-7', roles: ['driver', 'garage'] }, [
      'motorfix.read',
    ]);
    const list = jest.fn(async () => ({
      entries: [],
      from: '2026-10-09',
      lifts: true,
      to: '2026-10-09',
    }));
    const ctx = context({ garage: { schedule: { list } } });
    const listed = await visibleTools(
      [...catalogue, fixtureTools[0]],
      who,
      ctx,
    );

    await callTool(catalogue, who, ctx, 'get_schedule', {});

    expect(listed.map((t) => t.name).sort()).toEqual(
      ['get_my_account', 'list_my_cars', ...GARAGE_READS].sort(),
    );
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ garageId: 'garage-7', role: 'garage' }),
      {},
    );
  });

  it('lists the garage reads to nobody without a garage role', async () => {
    const listed = await visibleTools(
      catalogue,
      caller({ roles: ['driver'] }, ['motorfix.read']),
      context(),
    );
    expect(listed.map((t) => t.name)).toEqual(['get_my_account']);
  });

  // @traces 365-FR-010
  it.each(FORBIDDEN.map((pattern) => [pattern.source, pattern] as const))(
    'holds no tool about %s',
    (_source, pattern) => {
      for (const tool of catalogue) {
        expect(`${tool.name} ${tool.description}`).not.toMatch(pattern);
      }
    },
  );

  it('keeps the notice clear of the forbidden words', () => {
    for (const pattern of FORBIDDEN) {
      expect(USER_TEXT_NOTICE).not.toMatch(pattern);
    }
  });

  it.each([
    'pay_invoice',
    'change_password',
    'change_email',
    'delete_account',
    'upload_legal_document',
    'send_photo',
    'start_live_stream',
  ])('would refuse a tool named %s', (name) => {
    expect(FORBIDDEN.some((pattern) => pattern.test(name))).toBe(true);
  });
});
