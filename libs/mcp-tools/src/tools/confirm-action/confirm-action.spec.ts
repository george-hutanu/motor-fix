import { ConflictException } from '@nestjs/common';
import { z } from 'zod';

import { confirmAction } from './confirm-action';
import { catalogue } from '../../catalogue';
import {
  caller,
  connect,
  context,
  memoryConfirmations,
} from '../../fixtures.testing';
import {
  callTool,
  defineTool,
  type Scope,
  type ToolDefinition,
  visibleTools,
} from '../../registry';

const BOOKING = '7a0c1b9e-4f4e-4b8e-9d55-0f1f3c2a9b10';
const ARGS = { bookingId: BOOKING, note: 'rain' };

function cancelBooking(
  run: (...args: unknown[]) => Promise<unknown> = async () => ({
    cancelled: true,
    phone: '+40712345678',
  }),
) {
  const handler = jest.fn(run);
  const tool = defineTool({
    acts: true,
    annotations: { destructiveHint: true, readOnlyHint: false },
    description: 'Cancels a booking.',
    handler,
    inputSchema: { bookingId: z.uuid(), note: z.string() },
    name: 'cancel_booking',
    outputSchema: { cancelled: z.boolean() },
    preview: async () => ({ summary: 'Cancels the booking.' }),
    roles: ['driver'],
  });
  return { handler, tool };
}

function setup({
  canAct = true,
  language = 'en',
  maintenance = false,
  run,
  scopes = ['motorfix.read', 'motorfix.act'],
}: {
  canAct?: boolean;
  language?: 'ro' | 'en';
  maintenance?: boolean;
  run?: (...args: unknown[]) => Promise<unknown>;
  scopes?: Scope[];
} = {}) {
  let now = new Date('2026-10-26T10:00:00Z');
  const confirmations = memoryConfirmations(() => now);
  const { handler, tool } = cancelBooking(run);
  const tools: ToolDefinition[] = [tool, confirmAction];
  const ctx = context({ confirmations, maintenance });
  const ask = async () => {
    const first = await callTool(
      tools,
      caller({ language, roles: ['driver'] }),
      ctx,
      'cancel_booking',
      ARGS,
    );
    return (first.structuredContent as { confirmationId: string })
      .confirmationId;
  };
  const confirm = (
    args: unknown,
    who: { canAct?: boolean; grantId?: string; language?: 'ro' | 'en' } = {},
  ) =>
    callTool(
      tools,
      {
        ...caller(
          {
            canAct: who.canAct ?? canAct,
            language: who.language ?? language,
            roles: ['driver'],
          },
          scopes,
        ),
        grantId: who.grantId ?? 'grant-1',
      },
      ctx,
      'confirm_action',
      args,
    );
  return {
    ask,
    confirm,
    confirmations,
    handler,
    later: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

const statusOf = (id: string, rows: Map<string, { status: string }>) =>
  rows.get(id)?.status;

describe('confirm_action', () => {
  // @traces 1253-assistant-confirm-FR-004
  it('is in the catalogue, acting, destructive and idempotent, with no output schema, permission or garage feature', () => {
    expect(catalogue).toContain(confirmAction);
    expect(confirmAction).toMatchObject({
      acts: true,
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        readOnlyHint: false,
      },
    });
    expect(confirmAction.outputSchema).toBeUndefined();
    expect(confirmAction.capability).toBeUndefined();
    expect(confirmAction.garageFeature).toBeUndefined();
    expect(confirmAction.preview).toBeUndefined();
  });

  // @traces 1253-assistant-confirm-FR-004 1253-assistant-confirm-FR-007
  it.each([
    ['a driver who may act', ['driver'], true, true],
    ['a garage owner who may act', ['garage'], true, true],
    ['a read-only grant', ['driver'], false, true],
    ['an account with its switch off', ['driver'], true, false],
  ] as const)('is listed to %s: %s', async (_who, roles, acts, canAct) => {
    const scopes: Scope[] = acts
      ? ['motorfix.read', 'motorfix.act']
      : ['motorfix.read'];
    const listed = await visibleTools(
      [confirmAction],
      caller({ canAct, roles: [...roles] }, scopes),
      context(),
    );
    expect(listed.map((t) => t.name)).toEqual(
      acts && canAct ? ['confirm_action'] : [],
    );
  });

  // @traces 1253-assistant-confirm-FR-004
  it('runs the stored tool once at a timely yes and answers its declared output', async () => {
    const { ask, confirm, confirmations, handler } = setup();
    const confirmationId = await ask();

    const result = await confirm({
      arguments: ARGS,
      confirmationId,
      confirmed: true,
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ cancelled: true });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ assistantGrantId: 'grant-1', role: 'driver' }),
      ARGS,
      expect.anything(),
      expect.objectContaining({
        run: { confirmationId, tx: confirmations.tx },
      }),
    );
    expect(statusOf(confirmationId, confirmations.rows)).toBe('done');
  });

  // @traces 1253-assistant-confirm-FR-004
  it('equals the arguments whatever their key order', async () => {
    const { ask, confirm } = setup();
    const confirmationId = await ask();

    // Parsed from text, so the key order is the one written.
    const reordered = JSON.parse(`{"note":"rain","bookingId":"${BOOKING}"}`);

    const result = await confirm({
      arguments: reordered,
      confirmationId,
      confirmed: true,
    });

    expect(Object.keys(reordered)).toEqual(['note', 'bookingId']);
    expect(result.structuredContent).toEqual({ cancelled: true });
  });

  // @traces 1253-assistant-confirm-FR-004
  it('parses the arguments with the stored tool’s schema and refuses them as validation', async () => {
    const { ask, confirm, handler } = setup();
    const confirmationId = await ask();

    const result = await confirm({
      arguments: { bookingId: 'not-a-uuid', note: 'rain' },
      confirmationId,
      confirmed: true,
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: 'validation' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('refuses its own input as validation', async () => {
    const { confirm } = setup();
    const result = await confirm({ confirmationId: 'x', confirmed: 'yes' });
    expect(result.structuredContent).toMatchObject({ code: 'validation' });
  });

  // @traces 1253-assistant-confirm-FR-005
  it.each([
    [
      'a no',
      async (s: ReturnType<typeof setup>, id: string) =>
        s.confirm({ arguments: ARGS, confirmationId: id, confirmed: false }),
      'refused',
      'refused',
    ],
    [
      'a yes after the expiry',
      async (s: ReturnType<typeof setup>, id: string) => {
        s.later(5 * 60_000 + 1);
        return s.confirm({
          arguments: ARGS,
          confirmationId: id,
          confirmed: true,
        });
      },
      'expired',
      'expired',
    ],
    [
      'a yes with other arguments',
      async (s: ReturnType<typeof setup>, id: string) =>
        s.confirm({
          arguments: { ...ARGS, note: 'snow' },
          confirmationId: id,
          confirmed: true,
        }),
      'arguments_changed',
      'void',
    ],
    [
      'a yes to a voided confirmation',
      async (s: ReturnType<typeof setup>, id: string) => {
        await s.confirmations.voidForAccount('account-1');
        return s.confirm({
          arguments: ARGS,
          confirmationId: id,
          confirmed: true,
        });
      },
      'void',
      'void',
    ],
  ] as const)(
    'sends nothing on %s and says so',
    async (_case, answer, reason, status) => {
      const s = setup();
      const id = await s.ask();

      const result = await answer(s, id);

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({
        message: expect.stringMatching(/nothing was sent/i),
        reason,
        status: 'not_sent',
      });
      expect(s.handler).not.toHaveBeenCalled();
      expect(statusOf(id, s.confirmations.rows)).toBe(status);
    },
  );

  // @traces 1253-assistant-confirm-FR-005
  it('answers not_found to another grant’s confirmation and leaves it waiting', async () => {
    const { ask, confirm, confirmations, handler } = setup();
    const id = await ask();

    const result = await confirm(
      { arguments: ARGS, confirmationId: id, confirmed: true },
      { grantId: 'grant-2' },
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: 'not_found' });
    expect(handler).not.toHaveBeenCalled();
    expect(statusOf(id, confirmations.rows)).toBe('waiting');
  });

  // @traces 1253-assistant-confirm-FR-005
  it('answers not_found to an unknown id', async () => {
    const { confirm } = setup();
    const result = await confirm({
      arguments: ARGS,
      confirmationId: '00000000-0000-4000-8000-000000000999',
      confirmed: true,
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: 'not_found' });
  });

  // @traces 1253-assistant-confirm-FR-005
  it('answers the use case’s error when it fails at the yes, and stores it as failed', async () => {
    const s = setup({
      run: async () => {
        throw new ConflictException({ code: 'already_answered', message: 'x' });
      },
    });
    const id = await s.ask();

    const result = await s.confirm({
      arguments: ARGS,
      confirmationId: id,
      confirmed: true,
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      code: 'already_answered',
      message: 'Someone has already answered this request.',
    });
    expect(statusOf(id, s.confirmations.rows)).toBe('failed');
  });

  // @traces 1253-assistant-confirm-FR-006
  it('replays a done confirmation’s output without running again, whatever the arguments', async () => {
    const { ask, confirm, handler } = setup();
    const id = await ask();
    await confirm({ arguments: ARGS, confirmationId: id, confirmed: true });

    const again = await confirm({
      arguments: { ...ARGS, note: 'snow' },
      confirmationId: id,
      confirmed: false,
    });

    expect(again.isError).toBeFalsy();
    expect(again.structuredContent).toEqual({ cancelled: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  // @traces 1253-assistant-confirm-FR-006
  it('replays a failed confirmation’s error in the language of the repeat', async () => {
    const s = setup({
      run: async () => {
        throw new ConflictException({ code: 'already_answered', message: 'x' });
      },
    });
    const id = await s.ask();
    await s.confirm({ arguments: ARGS, confirmationId: id, confirmed: true });

    const again = await s.confirm(
      { arguments: ARGS, confirmationId: id, confirmed: true },
      { language: 'ro' },
    );

    expect(again.isError).toBe(true);
    expect(again.structuredContent).toEqual({
      code: 'already_answered',
      message: 'Altcineva a răspuns deja la această cerere.',
    });
    expect(s.handler).toHaveBeenCalledTimes(1);
  });

  // @traces 1253-assistant-confirm-FR-007
  it('refuses with the switch off and voids the account’s waiting confirmations', async () => {
    const { ask, confirm, confirmations, handler } = setup();
    const id = await ask();

    const result = await confirm(
      { arguments: ARGS, confirmationId: id, confirmed: true },
      { canAct: false },
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: 'assistant_act_off',
    });
    expect(handler).not.toHaveBeenCalled();
    expect(statusOf(id, confirmations.rows)).toBe('void');
  });

  // @traces 1253-assistant-confirm-FR-007
  it('refuses under the read-only scope', async () => {
    const s = setup();
    const id = await s.ask();
    const readOnly = setup({ scopes: ['motorfix.read'] });

    const result = await readOnly.confirm({
      arguments: ARGS,
      confirmationId: id,
      confirmed: true,
    });

    expect(result.structuredContent).toMatchObject({
      code: 'assistant_act_off',
    });
  });

  it('refuses under maintenance and leaves the confirmation waiting', async () => {
    const s = setup();
    const id = await s.ask();
    const paused = setup({ maintenance: true });

    const result = await paused.confirm({
      arguments: ARGS,
      confirmationId: id,
      confirmed: true,
    });

    expect(result.structuredContent).toMatchObject({ code: 'maintenance' });
    expect(statusOf(id, s.confirmations.rows)).toBe('waiting');
  });

  it('is served over the protocol with its errors in structured content', async () => {
    const client = await connect(
      [confirmAction],
      caller({ roles: ['driver'] }),
      context(),
    );
    const { tools } = await client.listTools();
    expect(tools[0]?.outputSchema).toBeUndefined();
    const answer = await client.callTool({
      arguments: {
        arguments: {},
        confirmationId: '00000000-0000-4000-8000-000000000999',
        confirmed: true,
      },
      name: 'confirm_action',
    });
    expect(answer).toMatchObject({
      isError: true,
      structuredContent: { code: 'not_found' },
    });
  });
});
