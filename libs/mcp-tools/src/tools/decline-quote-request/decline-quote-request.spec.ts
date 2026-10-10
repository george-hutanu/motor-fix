// @traces 345-decline-request-FR-017
import { ConflictException, ForbiddenException } from '@nestjs/common';

import { declineQuoteRequest } from './decline-quote-request';
import { catalogue } from '../../catalogue';
import { caller, connect, context } from '../../fixtures.testing';
import { callTool, type Scope, visibleTools } from '../../registry';

const REQUEST = '7a0c1b9e-4f4e-4b8e-9d55-0f1f3c2a9b10';

const DECLINED = {
  answeredAt: '2026-10-10T09:00:00.000Z',
  declinedAt: '2026-10-10T09:00:00.000Z',
  declineReason: 'fully_booked',
  source: 'search',
  status: 'declined',
};

const declineOf = (answer: () => Promise<unknown> = async () => DECLINED) =>
  jest.fn(answer);

const call = (
  args: unknown,
  {
    decline = declineOf(),
    language = 'ro',
    maintenance = false,
    scopes = ['motorfix.read', 'motorfix.act'],
  }: {
    decline?: jest.Mock;
    language?: 'ro' | 'en';
    maintenance?: boolean;
    scopes?: Scope[];
  } = {},
) =>
  callTool(
    [declineQuoteRequest],
    caller({ language, roles: ['garage'] }, scopes),
    context({ garage: { decline: { decline } }, maintenance }),
    'decline_quote_request',
    args,
  );

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

  it('declines as the assistant, for the grant, with the reason', async () => {
    const decline = declineOf();

    const result = await call(
      { reason: 'fully_booked', requestId: REQUEST },
      { decline },
    );

    expect(result.isError).toBeFalsy();
    expect(decline).toHaveBeenCalledWith(
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
  ])('refuses %s with validation and declines nothing', async (_, args) => {
    const decline = declineOf();

    const result = await call(args, { decline });

    expect(result.structuredContent).toMatchObject({ code: 'validation' });
    expect(decline).not.toHaveBeenCalled();
  });

  it('refuses a read-only grant and declines nothing', async () => {
    const decline = declineOf();

    const result = await call(
      { reason: 'fully_booked', requestId: REQUEST },
      { decline, scopes: ['motorfix.read'] },
    );

    expect(result.structuredContent).toMatchObject({
      code: 'assistant_act_off',
    });
    expect(decline).not.toHaveBeenCalled();
  });

  it('refuses under maintenance and declines nothing', async () => {
    const decline = declineOf();

    const result = await call(
      { reason: 'fully_booked', requestId: REQUEST },
      { decline, maintenance: true },
    );

    expect(result.structuredContent).toMatchObject({ code: 'maintenance' });
    expect(decline).not.toHaveBeenCalled();
  });

  it.each([
    ['already_answered', 'Someone has already answered this request.'],
    ['request_not_open', 'The request is no longer open.'],
  ])(
    'turns a 409 %s into a tool error with its own message',
    async (code, message) => {
      const decline = declineOf(async () => {
        throw new ConflictException({ code, message: 'x' });
      });

      const result = await call(
        { reason: 'fully_booked', requestId: REQUEST },
        { decline, language: 'en' },
      );

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({ code, message });
    },
  );

  it('turns a 403 into forbidden in Romanian', async () => {
    const decline = declineOf(async () => {
      throw new ForbiddenException({
        code: 'forbidden',
        message: 'Nu ai dreptul să răspunzi la cereri',
      });
    });

    const result = await call(
      { reason: 'fully_booked', requestId: REQUEST },
      { decline },
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: 'forbidden' });
    expect((result.structuredContent as { message: string }).message).toMatch(
      /\S/,
    );
  });
});

describe('decline_quote_request output schema', () => {
  it('declares one its answer fits, as the client checks it', async () => {
    const client = await connect(
      [declineQuoteRequest],
      caller({ roles: ['garage'] }),
      context({ garage: { decline: { decline: declineOf() as jest.Mock } } }),
    );
    const { tools } = await client.listTools();
    expect(tools[0].outputSchema).toBeDefined();
    expect(tools[0].annotations).toMatchObject({ destructiveHint: true });
    const answer = await client.callTool({
      arguments: { reason: 'need_to_see_car', requestId: REQUEST },
      name: 'decline_quote_request',
    });
    expect(answer.isError).toBeFalsy();
  });
});
