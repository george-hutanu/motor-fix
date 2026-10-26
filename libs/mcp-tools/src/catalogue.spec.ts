import { catalogue } from './catalogue';
import {
  caller,
  context,
  fixtureTools,
  memoryConfirmations,
} from './fixtures.testing';
import { callTool, USER_TEXT_NOTICE, visibleTools } from './registry';

const GARAGE_READS = [
  'get_day_sheet',
  'get_schedule',
  'get_stats',
  'list_quote_requests',
];

const GARAGE_ACTS = ['decline_quote_request'];

// The tool that carries the person's yes to every other act.
const CONFIRM = 'confirm_action';

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
  // @traces 1253-FR-004
  it('ships get_my_account, the four garage reads, decline_quote_request and confirm_action', () => {
    expect(catalogue.map((t) => t.name).sort()).toEqual(
      ['get_my_account', ...GARAGE_READS, ...GARAGE_ACTS, CONFIRM].sort(),
    );
    for (const tool of catalogue) {
      const acts = [...GARAGE_ACTS, CONFIRM].includes(tool.name);
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
      'garage-7',
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

// @traces 398-FR-004
describe('the garage feature switches', () => {
  it('have no tool: the assistant neither reads nor changes them', () => {
    for (const tool of catalogue) {
      expect(`${tool.name} ${tool.description}`).not.toMatch(
        /feature|switch|team_mechanics|lift_schedule|live_media|day_sheets|whatsapp/i,
      );
    }
  });
});

// Valid arguments for each acting tool: a tool added without them fails here.
const VALID: Record<string, unknown> = {
  decline_quote_request: {
    reason: 'fully_booked',
    requestId: '7a0c1b9e-4f4e-4b8e-9d55-0f1f3c2a9b10',
  },
};

const written = async (): Promise<never> => {
  throw new Error('a first call reached a write');
};

// @traces 1253-FR-001 1253-FR-008
describe('every acting tool', () => {
  const acting = catalogue.filter((t) => t.acts && t.name !== CONFIRM);

  it.each(acting.map((t) => [t.name, t] as const))(
    '%s has a preview',
    (_name, tool) => {
      expect(tool.preview).toBeDefined();
    },
  );

  it.each(acting.map((t) => [t.name, t] as const))(
    '%s, called once with valid arguments, writes nothing and answers confirmation_required',
    async (name, tool) => {
      expect(VALID[name]).toBeDefined();
      const confirmations = memoryConfirmations();
      const ctx = context({
        confirmations,
        garage: {
          decline: {
            preview: async () => ({
              car: { brand: 'Mini', model: 'Cooper', year: 2019 },
              driverFirstName: 'Andrei',
              garageName: 'Atelier',
              receivedAt: new Date('2026-10-26T10:52:00Z'),
            }),
            run: written,
          },
        },
      });

      const result = await callTool(
        [tool],
        caller({ roles: [...tool.roles] }),
        ctx,
        name,
        VALID[name],
      );

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        status: 'confirmation_required',
        tool: name,
      });
      expect([...confirmations.rows.values()].map((r) => r.status)).toEqual([
        'waiting',
      ]);
    },
  );
});
