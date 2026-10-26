// @traces 345-FR-017
import type { GarageRecipientDto } from '@motor-fix/contracts';
import type { DeclinePreview } from '@motor-fix/domain';
import { ConflictException, ForbiddenException } from '@nestjs/common';

import { declineQuoteRequest } from './decline-quote-request';
import { catalogue } from '../../catalogue';
import {
  caller,
  connect,
  context,
  memoryConfirmations,
} from '../../fixtures.testing';
import { callTool, type Scope, visibleTools } from '../../registry';
import { confirmAction } from '../confirm-action/confirm-action';

const REQUEST = '7a0c1b9e-4f4e-4b8e-9d55-0f1f3c2a9b10';

const DECLINED = {
  answeredAt: '2026-10-10T09:00:00.000Z',
  declinedAt: '2026-10-10T09:00:00.000Z',
  declineReason: 'fully_booked',
  source: 'search',
  status: 'declined',
};

const PREVIEW: DeclinePreview = {
  car: { brand: 'Mini', model: 'Cooper S', year: 2019 },
  driverFirstName: 'Andrei',
  garageName: 'Atelier Dinamo',
  // 13:52 in Bucharest (UTC+2 once summer time ends on 25 October).
  receivedAt: new Date('2026-10-26T11:52:00Z'),
};

const declineOf = (
  answer: () => Promise<GarageRecipientDto> = async () =>
    DECLINED as GarageRecipientDto,
  preview: () => Promise<DeclinePreview> = async () => PREVIEW,
) => ({ preview: jest.fn(preview), run: jest.fn(answer) });

type Decline = ReturnType<typeof declineOf>;

const call = (
  args: unknown,
  {
    confirmations = memoryConfirmations(),
    decline = declineOf(),
    language = 'ro',
    maintenance = false,
    scopes = ['motorfix.read', 'motorfix.act'],
  }: {
    confirmations?: ReturnType<typeof memoryConfirmations>;
    decline?: Decline;
    language?: 'ro' | 'en';
    maintenance?: boolean;
    scopes?: Scope[];
  } = {},
) =>
  callTool(
    [declineQuoteRequest, confirmAction],
    caller({ language, roles: ['garage'] }, scopes),
    context({ confirmations, garage: { decline }, maintenance }),
    'decline_quote_request',
    args,
  );

const ARGS = { reason: 'fully_booked', requestId: REQUEST };

describe('decline_quote_request', () => {
  it('is in the catalogue as an acting, destructive, non-idempotent tool for garage.requests', () => {
    expect(catalogue).toContain(declineQuoteRequest);
    expect(declineQuoteRequest.acts).toBe(true);
    expect(declineQuoteRequest.capability).toBe('garage.requests');
    expect(declineQuoteRequest.annotations).toEqual({
      destructiveHint: true,
      idempotentHint: false,
      readOnlyHint: false,
    });
  });

  it('tells the assistant to confirm the request and the reason with the person first', () => {
    expect(declineQuoteRequest.description).toMatch(/confirm/i);
    expect(declineQuoteRequest.description).toMatch(/reason/i);
  });

  it.each([
    ['an owner', { roles: ['garage'] as const }, true],
    ['a receptionist', { roles: ['receptionist'] as const }, true],
    [
      'a mechanic who may answer quotes',
      { mechanic: { canAnswerQuotes: true }, roles: ['mechanic'] as const },
      true,
    ],
    [
      'a mechanic who may not',
      { mechanic: {}, roles: ['mechanic'] as const },
      false,
    ],
    ['a driver', { roles: ['driver'] as const }, false],
  ])('is listed to %s: %s', async (_who, shape, shown) => {
    const listed = await visibleTools(
      [declineQuoteRequest],
      caller({ ...shape, roles: [...shape.roles] }),
      context(),
    );
    expect(listed.map((t) => t.name)).toEqual(
      shown ? ['decline_quote_request'] : [],
    );
  });

  // @traces 1253-assistant-confirm-FR-001 1253-assistant-confirm-FR-008
  it('first answers confirmation_required, stores one confirmation and declines nothing', async () => {
    const decline = declineOf();
    const confirmations = memoryConfirmations();

    const result = await call(ARGS, { confirmations, decline });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      confirmationId: expect.any(String),
      expiresAt: expect.any(String),
      status: 'confirmation_required',
      tool: 'decline_quote_request',
    });
    expect(decline.run).not.toHaveBeenCalled();
    expect(decline.preview).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantGrantId: 'grant-1',
        via: 'assistant',
      }),
      REQUEST,
    );
    expect([...confirmations.rows.values()]).toEqual([
      expect.objectContaining({
        accountId: 'account-1',
        grantId: 'grant-1',
        status: 'waiting',
        tool: 'decline_quote_request',
      }),
    ]);
  });

  // @traces 1253-assistant-confirm-FR-001 1253-assistant-confirm-FR-008
  it.each([
    [
      'ro',
      'Service-ul Atelier Dinamo refuză cererea lui Andrei pentru Mini Cooper S (2019), primită pe 26.10.2026 la 13:52, cu motivul: Suntem ocupați complet.',
    ],
    [
      'en',
      "Atelier Dinamo declines Andrei's request for a Mini Cooper S (2019), received on 26.10.2026 at 13:52, with the reason: We are fully booked.",
    ],
  ] as const)('summarises the decline in %s', async (language, summary) => {
    const result = await call(ARGS, { language });

    expect((result.structuredContent as { summary: string }).summary).toBe(
      summary,
    );
  });

  // @traces 1253-assistant-confirm-FR-001
  it('never names a phone or a plate in the summary', async () => {
    const result = await call(ARGS);
    const summary = (result.structuredContent as { summary: string }).summary;
    expect(summary).not.toMatch(
      /\+?\d{9,}|[A-Z]{1,2}[- ]?\d{2,3}[- ]?[A-Z]{3}/,
    );
  });

  // @traces 1253-assistant-confirm-FR-004
  it('declines at the yes, as the assistant, for the grant, with the reason, inside the confirmation', async () => {
    const decline = declineOf();
    const confirmations = memoryConfirmations();
    const first = await call(ARGS, { confirmations, decline });
    const { confirmationId } = first.structuredContent as {
      confirmationId: string;
    };

    const result = await callTool(
      [declineQuoteRequest, confirmAction],
      caller({ roles: ['garage'] }),
      context({ confirmations, garage: { decline } }),
      'confirm_action',
      { arguments: ARGS, confirmationId, confirmed: true },
    );

    expect(result.isError).toBeFalsy();
    expect(decline.run).toHaveBeenCalledWith(
      confirmations.tx,
      expect.objectContaining({
        assistantGrantId: 'grant-1',
        role: 'garage',
        via: 'assistant',
      }),
      REQUEST,
      'fully_booked',
    );
    expect(result.structuredContent).toEqual(DECLINED);
  });

  it.each([
    ['no reason', { requestId: REQUEST }],
    ['an unknown reason', { reason: 'too_far', requestId: REQUEST }],
    [
      'a request id that is not a uuid',
      { reason: 'fully_booked', requestId: 'req-1' },
    ],
  ])('refuses %s with validation and stores nothing', async (_, args) => {
    const decline = declineOf();
    const confirmations = memoryConfirmations();

    const result = await call(args, { confirmations, decline });

    expect(result.structuredContent).toMatchObject({ code: 'validation' });
    expect(decline.preview).not.toHaveBeenCalled();
    expect(confirmations.rows.size).toBe(0);
  });

  it('refuses a read-only grant and stores nothing', async () => {
    const decline = declineOf();
    const confirmations = memoryConfirmations();

    const result = await call(ARGS, {
      confirmations,
      decline,
      scopes: ['motorfix.read'],
    });

    expect(result.structuredContent).toMatchObject({
      code: 'assistant_act_off',
    });
    expect(decline.preview).not.toHaveBeenCalled();
    expect(confirmations.rows.size).toBe(0);
  });

  it('refuses under maintenance and stores nothing', async () => {
    const decline = declineOf();
    const confirmations = memoryConfirmations();

    const result = await call(ARGS, {
      confirmations,
      decline,
      maintenance: true,
    });

    expect(result.structuredContent).toMatchObject({ code: 'maintenance' });
    expect(decline.preview).not.toHaveBeenCalled();
    expect(confirmations.rows.size).toBe(0);
  });

  // @traces 1253-assistant-confirm-FR-002
  it.each([
    ['already_answered', 'Someone has already answered this request.'],
    ['request_not_open', 'The request is no longer open.'],
  ])(
    'answers a 409 %s from the preview with its own message and stores no confirmation',
    async (code, message) => {
      const confirmations = memoryConfirmations();
      const decline = declineOf(undefined, async () => {
        throw new ConflictException({ code, message: 'x' });
      });

      const result = await call(ARGS, {
        confirmations,
        decline,
        language: 'en',
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({ code, message });
      expect(confirmations.rows.size).toBe(0);
    },
  );

  // @traces 1253-assistant-confirm-FR-002
  it('answers a 403 from the preview as forbidden in Romanian', async () => {
    const confirmations = memoryConfirmations();
    const decline = declineOf(undefined, async () => {
      throw new ForbiddenException({
        code: 'forbidden',
        message: 'Nu ai dreptul să răspunzi la cereri',
      });
    });

    const result = await call(ARGS, { confirmations, decline });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: 'forbidden' });
    expect((result.structuredContent as { message: string }).message).toMatch(
      /\S/,
    );
    expect(confirmations.rows.size).toBe(0);
  });
});

describe('decline_quote_request over the protocol', () => {
  // @traces 1253-assistant-confirm-FR-008
  it('lists no output schema, its first answer being the confirmation', async () => {
    const client = await connect(
      [declineQuoteRequest, confirmAction],
      caller({ roles: ['garage'] }),
      context({ garage: { decline: declineOf() } }),
    );
    const { tools } = await client.listTools();
    const listed = tools.find((t) => t.name === 'decline_quote_request');
    expect(listed?.outputSchema).toBeUndefined();
    expect(listed?.annotations).toMatchObject({ destructiveHint: true });
    const answer = await client.callTool({
      arguments: { reason: 'need_to_see_car', requestId: REQUEST },
      name: 'decline_quote_request',
    });
    expect(answer.isError).toBeFalsy();
    expect(answer.structuredContent).toMatchObject({
      status: 'confirmation_required',
    });
  });

  it('keeps a refusal in structured content', async () => {
    const client = await connect(
      [declineQuoteRequest, confirmAction],
      caller({ roles: ['garage'] }, ['motorfix.read', 'motorfix.act']),
      context({ maintenance: true }),
    );
    const answer = await client.callTool({
      arguments: ARGS,
      name: 'decline_quote_request',
    });
    expect(answer).toMatchObject({
      isError: true,
      structuredContent: { code: 'maintenance' },
    });
  });
});
