import { z } from 'zod';

import {
  bookFixture,
  caller,
  connect,
  context,
  fixtureTools,
  memoryApprovals,
  memoryConfirmations,
} from './fixtures.testing';
import { callTool, defineTool, visibleTools } from './registry';
import { confirmAction } from './tools/confirm-action/confirm-action';

const names = async (...args: Parameters<typeof visibleTools>) =>
  (await visibleTools(...args)).map((t) => t.name).sort();

const codeOf = (result: { structuredContent?: unknown }) =>
  (result.structuredContent as { code?: string } | undefined)?.code;

describe('tool visibility', () => {
  // @traces 365-FR-006
  it('lists the tools of every role the account holds', async () => {
    const listed = await names(
      fixtureTools,
      caller({ roles: ['driver', 'garage'] }),
      context(),
    );
    expect(listed).toEqual(
      [
        'add_job_note',
        'book_service',
        'list_my_cars',
        'list_quote_requests',
        'send_quote',
        'show_day_sheet',
        'show_latest_review',
        'update_price',
      ].sort(),
    );
  });

  it('hides update_price from a receptionist', async () => {
    const listed = await names(
      fixtureTools,
      caller({ roles: ['receptionist'] }),
      context(),
    );
    expect(listed).not.toContain('update_price');
    expect(listed).toContain('send_quote');
  });

  it('shows quote tools to a mechanic only with can_answer_quotes', async () => {
    const quoteTools = ['add_job_note', 'list_quote_requests', 'send_quote'];
    const without = await names(
      fixtureTools,
      caller({ mechanic: { canAnswerQuotes: false }, roles: ['mechanic'] }),
      context(),
    );
    const withIt = await names(
      fixtureTools,
      caller({ mechanic: { canAnswerQuotes: true }, roles: ['mechanic'] }),
      context(),
    );
    expect(without).toEqual([]);
    expect(withIt).toEqual(quoteTools);
  });

  it('hides acting tools under the read-only scope', async () => {
    const listed = await names(
      fixtureTools,
      caller({ roles: ['driver'] }, ['motorfix.read']),
      context(),
    );
    expect(listed).toEqual(['list_my_cars']);
  });

  it('hides read tools when the token carries no read scope', async () => {
    const listed = await names(
      fixtureTools,
      caller({ roles: ['driver'] }, ['motorfix.act']),
      context(),
    );
    expect(listed).toEqual(['book_service']);
    expect(
      await names(fixtureTools, caller({ roles: ['driver'] }, []), context()),
    ).toEqual([]);
  });

  it('hides a tool whose garage feature is off', async () => {
    const listed = await names(
      fixtureTools,
      caller({ roles: ['garage'] }),
      context({ features: { day_sheets: false } }),
    );
    expect(listed).not.toContain('show_day_sheet');
    expect(listed).toContain('list_quote_requests');
  });

  it('shows a role added since the grant at the next listing', async () => {
    const before = await names(
      fixtureTools,
      caller({ roles: ['driver'] }),
      context(),
    );
    const after = await names(
      fixtureTools,
      caller({ roles: ['driver', 'garage'] }),
      context(),
    );
    expect(before).not.toContain('send_quote');
    expect(after).toContain('send_quote');
  });
});

describe('tool calls', () => {
  // @traces 365-FR-006
  it('answers assistant_act_off to an acting call under the read-only scope', async () => {
    const result = await callTool(
      fixtureTools,
      caller({ roles: ['driver'] }, ['motorfix.read']),
      context(),
      'book_service',
      { garageId: 'g' },
    );
    expect(result.isError).toBe(true);
    expect(codeOf(result)).toBe('assistant_act_off');
  });

  // @traces 365-FR-006
  it('answers assistant_read_off to a read call without the read scope', async () => {
    const result = await callTool(
      fixtureTools,
      caller({ roles: ['driver'] }, ['motorfix.act']),
      context(),
      'list_my_cars',
      {},
    );
    expect(result.isError).toBe(true);
    expect(codeOf(result)).toBe('assistant_read_off');
  });

  it.each([
    ['a role the account lacks', ['driver'], 'send_quote', {}],
    ['an unknown tool', ['garage'], 'delete_everything', {}],
  ] as const)('answers not_found to %s', async (_case, roles, name, args) => {
    const result = await callTool(
      fixtureTools,
      caller({ roles: [...roles] }),
      context(),
      name,
      args,
    );
    expect(codeOf(result)).toBe('not_found');
  });

  it('answers not_found when the garage feature is off', async () => {
    const result = await callTool(
      fixtureTools,
      caller({ roles: ['garage'] }),
      context({ features: { day_sheets: false } }),
      'show_day_sheet',
      {},
    );
    expect(codeOf(result)).toBe('not_found');
  });

  it('checks visibility again on every call', async () => {
    let on = true;
    const ctx = { ...context(), featureOn: async () => on };
    const who = caller({ roles: ['garage'] });
    const first = await callTool(fixtureTools, who, ctx, 'show_day_sheet', {});
    on = false;
    const second = await callTool(fixtureTools, who, ctx, 'show_day_sheet', {});
    expect(first.isError).toBeFalsy();
    expect(codeOf(second)).toBe('not_found');
  });

  it('runs the tool as the role of its set the account holds', async () => {
    const seen: string[] = [];
    const tool = {
      ...fixtureTools[4],
      handler: async (actor: { role: string }) => {
        seen.push(actor.role);
        return {};
      },
    };
    await callTool(
      [tool],
      caller({ roles: ['driver', 'receptionist'] }),
      context(),
      tool.name,
      {},
    );
    expect(seen).toEqual(['receptionist']);
  });

  it('gives the handler an assistant actor', async () => {
    let actor: unknown;
    const tool = {
      ...fixtureTools[0],
      handler: async (a: unknown) => {
        actor = a;
        return {};
      },
    };
    await callTool(
      [tool],
      caller({ language: 'en', roles: ['driver'] }, ['motorfix.read']),
      context(),
      tool.name,
      {},
    );
    expect(actor).toMatchObject({
      accountId: 'account-1',
      assistantGrantId: 'grant-1',
      language: 'en',
      requestId: 'request-1',
      role: 'driver',
      roles: ['driver'],
      scopes: ['motorfix.read'],
      via: 'assistant',
    });
  });
});

describe('register', () => {
  it('serves the listing and the calls over the protocol', async () => {
    const client = await connect(
      fixtureTools,
      caller({ roles: ['driver'] }, ['motorfix.read']),
      context(),
    );
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['list_my_cars']);
    expect(tools[0]).toMatchObject({
      annotations: { destructiveHint: false, readOnlyHint: true },
      inputSchema: { type: 'object' },
    });
    const refused = await client.callTool({
      arguments: { garageId: 'g' },
      name: 'book_service',
    });
    expect(refused).toMatchObject({
      isError: true,
      structuredContent: { code: 'assistant_act_off' },
    });
    const answered = await client.callTool({
      arguments: {},
      name: 'list_my_cars',
    });
    expect(answered.structuredContent).toEqual({ ok: true });
    expect(answered.content).toEqual([
      { text: JSON.stringify({ ok: true }), type: 'text' },
    ]);
  });

  // @traces 365-FR-015
  it('runs every call through the observer it is given, with the name asked for', async () => {
    const seen: string[] = [];
    const client = await connect(
      fixtureTools,
      caller({ roles: ['driver'] }, ['motorfix.read']),
      context(),
      async (name, call) => {
        seen.push(name);
        return call();
      },
    );

    const answered = await client.callTool({
      arguments: {},
      name: 'list_my_cars',
    });
    await client.callTool({ arguments: {}, name: 'no_such_tool' });

    expect(answered.structuredContent).toEqual({ ok: true });
    expect(seen).toEqual(['list_my_cars', 'no_such_tool']);
  });
});

// An acting tool with a preview, as every acting tool of the catalogue is.
function previewed() {
  const handler = jest.fn(async () => ({ moved: true, secret: 'x' }));
  const preview = jest.fn(async () => ({ summary: 'Moves the booking.' }));
  const tool = defineTool({
    acts: true,
    annotations: { destructiveHint: true, readOnlyHint: false },
    description: 'Moves a booking.',
    handler,
    inputSchema: { at: z.string() },
    name: 'move_booking',
    outputSchema: { moved: z.boolean() },
    preview,
    roles: ['driver'],
  });
  return { handler, preview, tool };
}

describe('the confirmation step', () => {
  // @traces 1253-FR-001
  it('answers an acting tool’s first call with confirmation_required and stores one confirmation', async () => {
    const { handler, preview, tool } = previewed();
    const confirmations = memoryConfirmations();

    const result = await callTool(
      [tool, confirmAction],
      caller({ roles: ['driver'] }),
      context({ confirmations }),
      'move_booking',
      { at: '10:00', ignored: true },
    );

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      status: 'confirmation_required',
      summary: 'Moves the booking.',
      tool: 'move_booking',
    });
    expect(preview).toHaveBeenCalledWith(
      expect.objectContaining({ via: 'assistant' }),
      { at: '10:00' },
      expect.anything(),
    );
    expect(handler).not.toHaveBeenCalled();
    expect(confirmations.rows.size).toBe(1);
  });

  // @traces 1253-FR-008
  it('lists an acting tool with a preview without its output schema, and keeps a read’s', async () => {
    const { tool } = previewed();
    const listed = await visibleTools(
      [tool, confirmAction, fixtureTools[0]],
      caller({ roles: ['driver'] }),
      context(),
    );
    const byName = Object.fromEntries(listed.map((t) => [t.name, t]));
    expect(byName['move_booking']?.outputSchema).toBeUndefined();
    expect(byName['confirm_action']?.outputSchema).toBeUndefined();
    expect(byName['confirm_action']?.annotations).toEqual({
      destructiveHint: true,
      idempotentHint: true,
      readOnlyHint: false,
    });
  });

  // @traces 1253-FR-007
  it('hides every acting tool and refuses it while the account’s switch is off, voiding its confirmations', async () => {
    const { tool } = previewed();
    const confirmations = memoryConfirmations();
    const ctx = context({ confirmations });
    const opened = await callTool(
      [tool],
      caller({ roles: ['driver'] }),
      ctx,
      'move_booking',
      { at: '10:00' },
    );
    const { confirmationId } = opened.structuredContent as {
      confirmationId: string;
    };
    const off = caller({ canAct: false, roles: ['driver'] });

    const listed = await visibleTools([tool, ...fixtureTools], off, ctx);
    const result = await callTool([tool], off, ctx, 'move_booking', {
      at: '10:00',
    });

    expect(listed.map((t) => t.name)).not.toContain('move_booking');
    expect(listed.map((t) => t.name)).not.toContain('book_service');
    expect(result.structuredContent).toMatchObject({
      code: 'assistant_act_off',
    });
    expect(confirmations.rows.get(confirmationId)?.status).toBe('void');
  });
});

describe('the confirmation step over elicitation', () => {
  const connected = (
    elicit?: (params: { message: string; requestedSchema: unknown }) => unknown,
    language: 'ro' | 'en' = 'en',
  ) => {
    const parts = previewed();
    const confirmations = memoryConfirmations();
    const client = connect(
      [parts.tool, confirmAction],
      caller({ language, roles: ['driver'] }),
      context({ confirmations }),
      undefined,
      elicit,
    );
    return { ...parts, client, confirmations };
  };

  // @traces 1253-FR-003
  it('asks the person with the summary and runs the action on yes', async () => {
    const asked: { message: string; requestedSchema: unknown }[] = [];
    const { client, confirmations, handler } = connected(async (params) => {
      asked.push(params);
      return { action: 'accept', content: { confirm: true } };
    }, 'ro');

    const answer = await (await client).callTool({
      arguments: { at: '10:00' },
      name: 'move_booking',
    });

    expect(asked).toEqual([
      expect.objectContaining({
        message: 'Moves the booking.',
        requestedSchema: {
          properties: { confirm: { title: 'Da', type: 'boolean' } },
          required: ['confirm'],
          type: 'object',
        },
      }),
    ]);
    expect(answer.isError).toBeFalsy();
    expect(answer.structuredContent).toEqual({ moved: true });
    expect(handler).toHaveBeenCalledTimes(1);
    expect([...confirmations.rows.values()][0]?.status).toBe('done');
  });

  // @traces 1253-FR-003 1253-FR-005
  it.each([
    ['a no', { action: 'accept', content: { confirm: false } }],
    ['a declined question', { action: 'decline' }],
    ['a cancelled question', { action: 'cancel' }],
  ])('writes nothing on %s and says nothing was sent', async (_case, reply) => {
    const { client, confirmations, handler } = connected(async () => reply);

    const answer = await (await client).callTool({
      arguments: { at: '10:00' },
      name: 'move_booking',
    });

    expect(answer.isError).toBeFalsy();
    expect(answer.structuredContent).toMatchObject({
      reason: 'refused',
      status: 'not_sent',
    });
    expect(handler).not.toHaveBeenCalled();
    expect([...confirmations.rows.values()][0]?.status).toBe('refused');
  });

  // @traces 1253-FR-003
  it('answers confirmation_required to a client that declared no elicitation', async () => {
    const { client, handler } = connected();

    const answer = await (await client).callTool({
      arguments: { at: '10:00' },
      name: 'move_booking',
    });

    expect(answer.structuredContent).toMatchObject({
      status: 'confirmation_required',
    });
    expect(handler).not.toHaveBeenCalled();
  });
});

const QUOTE = '7a0c1b9e-4f4e-4b8e-9d55-0f1f3c2a9b10';
const BOOK_ARGS = { quoteId: QUOTE, shareHistory: true };

// The fixture booking tool behind a spied handler, its yes and its stores.
function approvalSetup(language: 'ro' | 'en' = 'ro') {
  let now = new Date('2026-10-29T10:00:00Z');
  const confirmations = memoryConfirmations(() => now);
  const approvals = memoryApprovals(() => now);
  const handler = jest.spyOn(bookFixture, 'handler');
  const tools = [bookFixture, confirmAction];
  const ctx = context({ approvals, confirmations });
  const who = caller({ language, roles: ['driver'] });
  const ask = async () => {
    const first = await callTool(tools, who, ctx, 'book_fixture', BOOK_ARGS);
    return (first.structuredContent as { confirmationId: string })
      .confirmationId;
  };
  const confirm = (confirmationId: string, confirmed = true) =>
    callTool(tools, who, ctx, 'confirm_action', {
      arguments: BOOK_ARGS,
      confirmationId,
      confirmed,
    });
  return {
    approvals,
    ask,
    confirm,
    confirmations,
    handler,
    later: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

describe('in-app approval at the yes', () => {
  afterEach(() => jest.restoreAllMocks());

  // @traces 1254-assistant-approvals-FR-001
  // @traces 1254-assistant-approvals-FR-002
  it('saves a pending approval in the confirmation’s transaction, runs nothing and answers approval_required in Romanian', async () => {
    const { approvals, ask, confirm, confirmations, handler } = approvalSetup();
    const confirmationId = await ask();

    const result = await confirm(confirmationId);

    const [approval] = [...approvals.rows.values()];
    expect(handler).not.toHaveBeenCalled();
    expect(approvals.rows.size).toBe(1);
    expect(approval).toMatchObject({
      accountId: 'account-1',
      args: BOOK_ARGS,
      editable: ['shareHistory'],
      grantId: 'grant-1',
      kind: 'book',
      summary: 'Rezervă serviciul de probă.',
      tool: 'book_fixture',
      tx: confirmations.tx,
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      approvalId: approval?.id,
      expiresAt: '2026-10-29T10:30:00.000Z',
      message: 'Aprobă în aplicația MotorFix.',
      status: 'approval_required',
    });
    expect(confirmations.rows.get(confirmationId)?.status).toBe('done');
  });

  // @traces 1254-assistant-approvals-FR-002
  it('answers in English for an English account', async () => {
    const { ask, confirm } = approvalSetup('en');

    const result = await confirm(await ask());

    expect(result.structuredContent).toMatchObject({
      message: 'Approve it in the MotorFix app.',
      status: 'approval_required',
    });
  });

  // @traces 1254-assistant-approvals-FR-002
  it('replays the stored answer on a repeated yes and saves no second approval', async () => {
    const { approvals, ask, confirm, handler } = approvalSetup();
    const confirmationId = await ask();

    const first = await confirm(confirmationId);
    const again = await confirm(confirmationId);

    expect(again.structuredContent).toEqual(first.structuredContent);
    expect(approvals.rows.size).toBe(1);
    expect(handler).not.toHaveBeenCalled();
  });

  // @traces 1254-assistant-approvals-FR-001
  it('saves nothing on a no or a late yes, answering not_sent as before', async () => {
    const refused = approvalSetup('en');
    const late = approvalSetup('en');
    const lateId = await late.ask();
    late.later(6 * 60_000);

    const no = await refused.confirm(await refused.ask(), false);
    const tooLate = await late.confirm(lateId);

    expect(no.structuredContent).toMatchObject({
      reason: 'refused',
      status: 'not_sent',
    });
    expect(tooLate.structuredContent).toMatchObject({
      reason: 'expired',
      status: 'not_sent',
    });
    expect(refused.approvals.rows.size + late.approvals.rows.size).toBe(0);
  });

  // @traces 1254-assistant-approvals-FR-001
  it('saves the approval on a yes given over elicitation too', async () => {
    const approvals = memoryApprovals();
    const handler = jest.spyOn(bookFixture, 'handler');
    const client = await connect(
      [bookFixture, confirmAction],
      caller({ language: 'en', roles: ['driver'] }),
      context({ approvals }),
      undefined,
      async () => ({ action: 'accept', content: { confirm: true } }),
    );

    const answer = await client.callTool({
      arguments: BOOK_ARGS,
      name: 'book_fixture',
    });

    expect(answer.structuredContent).toMatchObject({
      status: 'approval_required',
    });
    expect(approvals.rows.size).toBe(1);
    expect(handler).not.toHaveBeenCalled();
  });

  // @traces 1254-assistant-approvals-FR-001
  it('runs a tool that declares no approval at once, keyed by the confirmation', async () => {
    const { handler, tool } = previewed();
    const confirmations = memoryConfirmations();
    const approvals = memoryApprovals();
    const ctx = context({ approvals, confirmations });
    const who = caller({ roles: ['driver'] });
    const first = await callTool(
      [tool, confirmAction],
      who,
      ctx,
      'move_booking',
      { at: '10:00' },
    );
    const { confirmationId } = first.structuredContent as {
      confirmationId: string;
    };

    const result = await callTool(
      [tool, confirmAction],
      who,
      ctx,
      'confirm_action',
      { arguments: { at: '10:00' }, confirmationId, confirmed: true },
    );

    expect(result.structuredContent).toEqual({ moved: true });
    expect(handler).toHaveBeenCalledWith(
      expect.anything(),
      { at: '10:00' },
      expect.anything(),
      expect.objectContaining({
        run: { key: confirmationId, tx: confirmations.tx },
      }),
    );
    expect(approvals.rows.size).toBe(0);
  });
});
