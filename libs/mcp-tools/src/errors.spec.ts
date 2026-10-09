import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { refusal, text, toolError } from './errors';
import { caller, context, fixtureTools } from './fixtures.testing';
import { callTool } from './registry';

const codeOf = (result: { structuredContent?: unknown }) =>
  (result.structuredContent as { code?: string } | undefined)?.code;

const alreadyDecided = () =>
  new HttpException(
    { code: 'already_decided', message: 'This request was already decided' },
    HttpStatus.CONFLICT,
  );

describe('toolError', () => {
  // @traces 365-FR-009
  it('keeps a use case’s code and words it in the account’s language', () => {
    const ro = toolError(alreadyDecided(), 'ro');
    const en = toolError(alreadyDecided(), 'en');
    expect(ro.code).toBe('already_decided');
    expect(en.code).toBe('already_decided');
    expect(ro.message).not.toBe(en.message);
    expect(ro.message.length).toBeGreaterThan(0);
    expect(en.message.length).toBeGreaterThan(0);
  });

  it('keeps another person’s resource not_found', () => {
    expect(toolError(new NotFoundException(), 'en').code).toBe('not_found');
  });

  it('reads the status when the exception carries no code', () => {
    expect(toolError(new ConflictException(), 'en').code).toBe('conflict');
  });

  it.each([
    [
      'the client cannot start',
      Object.assign(new Error('Can’t reach database server'), {
        name: 'PrismaClientInitializationError',
      }),
    ],
    [
      'the server is unreachable',
      Object.assign(new Error('P1001'), {
        code: 'P1001',
        name: 'PrismaClientKnownRequestError',
      }),
    ],
    [
      'the connection closed',
      Object.assign(new Error('P1017'), {
        code: 'P1017',
        name: 'PrismaClientKnownRequestError',
      }),
    ],
  ])('answers service_unavailable when %s', (_case, error) => {
    const answer = toolError(error, 'ro');
    expect(answer.code).toBe('service_unavailable');
    expect(answer.message).not.toContain('database');
  });

  it('answers internal_error to an unknown failure and keeps its words out', () => {
    const logged = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const answer = toolError(new Error('secret stack detail'), 'en');
    expect(answer.code).toBe('internal_error');
    expect(answer.message).not.toContain('secret');
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });

  it('words its own refusals in both languages', () => {
    for (const code of [
      'assistant_act_off',
      'assistant_read_off',
      'not_found',
      'validation',
      'maintenance',
      'service_unavailable',
    ]) {
      const ro = refusal(code, 'ro');
      const en = refusal(code, 'en');
      expect([ro.code, en.code]).toEqual([code, code]);
      expect(ro.message).not.toBe(en.message);
    }
  });
});

describe('garage read texts', () => {
  // @traces 374-FR-006
  it('lists the garage’s mechanics beside an unknown mechanic, worded in the account’s language', () => {
    const mechanics = [{ id: 'm-1', name: 'Costel Ionescu' }];
    const unknown = () =>
      new NotFoundException({
        code: 'mechanic_not_found',
        mechanics,
        message: 'No mechanic of this garage has that name',
      });
    const ro = toolError(unknown(), 'ro');
    const en = toolError(unknown(), 'en');
    expect(ro).toEqual({
      code: 'mechanic_not_found',
      mechanics,
      message: refusal('mechanic_not_found', 'ro').message,
    });
    expect(en).toMatchObject({ code: 'mechanic_not_found', mechanics });
    expect(ro.message).not.toBe(en.message);
    expect(ro.message).not.toBe(text('missing', 'ro'));
  });

  it('passes on only the details a tool names, never any other key of the body', () => {
    const leaky = new BadRequestException({
      accountId: 'acc-9',
      code: 'validation',
      message: 'bad',
      phone: '+40712345678',
      query: 'SELECT 1',
    });
    expect(toolError(leaky, 'en')).toEqual(refusal('validation', 'en'));
  });

  it('keeps Nest’s own status fields out of a refusal', () => {
    expect(toolError(new NotFoundException(), 'en')).toEqual(
      refusal('not_found', 'en'),
    );
  });

  // @traces 374-FR-011
  it.each([
    'empty_requests',
    'empty_schedule',
    'empty_day_sheet',
    'empty_stats',
  ])('words the %s note in Romanian and English', (key) => {
    const ro = text(key, 'ro');
    const en = text(key, 'en');
    expect(ro.length).toBeGreaterThan(0);
    expect(en.length).toBeGreaterThan(0);
    expect(ro).not.toBe(en);
    expect(ro).not.toBe(text('missing', 'ro'));
  });
});

describe('errors through a call', () => {
  // @traces 365-FR-017
  it('answers a use case refusal as a tool error in the actor’s language', async () => {
    const tool = {
      ...fixtureTools[0],
      handler: async () => {
        throw alreadyDecided();
      },
    };
    const result = await callTool(
      [tool],
      caller({ language: 'en', roles: ['driver'] }),
      context(),
      tool.name,
      {},
    );
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual(toolError(alreadyDecided(), 'en'));
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual(
      result.structuredContent,
    );
  });

  // @traces 365-FR-009
  it('refuses an acting tool with maintenance while reads answer', async () => {
    const ctx = context({ maintenance: true });
    const who = caller({ roles: ['driver'] });
    const acting = await callTool(fixtureTools, who, ctx, 'book_service', {
      garageId: 'g',
    });
    const reading = await callTool(fixtureTools, who, ctx, 'list_my_cars', {});
    expect(codeOf(acting)).toBe('maintenance');
    expect(reading.isError).toBeFalsy();
  });

  it('refuses bad input with validation and runs nothing', async () => {
    const handler = jest.fn(async () => ({}));
    const tool = { ...fixtureTools[1], handler };
    const result = await callTool(
      [tool],
      caller({ roles: ['driver'] }),
      context(),
      tool.name,
      { garageId: 42 },
    );
    expect(codeOf(result)).toBe('validation');
    expect(handler).not.toHaveBeenCalled();
  });

  it('answers service_unavailable when the database is down', async () => {
    const tool = {
      ...fixtureTools[0],
      handler: async () => {
        throw Object.assign(new Error('down'), {
          name: 'PrismaClientInitializationError',
        });
      },
    };
    const result = await callTool(
      [tool],
      caller({ roles: ['driver'] }),
      context(),
      tool.name,
      {},
    );
    expect(codeOf(result)).toBe('service_unavailable');
  });
});
