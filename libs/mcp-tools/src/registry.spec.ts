import { caller, connect, context, fixtureTools } from './fixtures.testing';
import { callTool, visibleTools } from './registry';

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
        'reply_to_review',
        'send_quote',
        'show_day_sheet',
        'show_latest_review',
      ].sort(),
    );
  });

  it('hides reply_to_review from a receptionist', async () => {
    const listed = await names(
      fixtureTools,
      caller({ roles: ['receptionist'] }),
      context(),
    );
    expect(listed).not.toContain('reply_to_review');
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
});
