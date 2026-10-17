import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SuspendGarageDto } from './garage-suspension.dto';

async function check(body: unknown) {
  const dto = plainToInstance(SuspendGarageDto, body);
  const errors = await validate(dto);
  return { dto, fields: errors.map((e) => e.property).sort() };
}

const ok = { cause: 'admin', reason: 'Motiv' };

// @traces 049-FR-005
describe('SuspendGarageDto under hostile input', () => {
  it('accepts a reason of exactly 200 characters and refuses 201', async () => {
    expect((await check({ ...ok, reason: 'a'.repeat(200) })).fields).toEqual(
      [],
    );
    expect((await check({ ...ok, reason: 'a'.repeat(201) })).fields).toEqual([
      'reason',
    ]);
  });

  it('measures the length after trimming', async () => {
    const padded = `  ${'a'.repeat(200)}  `;
    const { dto, fields } = await check({ ...ok, reason: padded });
    expect(fields).toEqual([]);
    expect(dto.reason).toBe('a'.repeat(200));
  });

  it.each([['   '], ['\t\n '], ['']])(
    'refuses the blank reason %j',
    async (r) => {
      expect((await check({ ...ok, reason: r })).fields).toEqual(['reason']);
    },
  );

  it.each([[null], [undefined], [12], [true], [['a']], [{ a: 1 }]])(
    'refuses the non-string reason %j',
    async (r) => {
      expect((await check({ ...ok, reason: r })).fields).toEqual(['reason']);
    },
  );

  it('refuses a missing reason and a missing cause', async () => {
    expect((await check({ cause: 'admin' })).fields).toEqual(['reason']);
    expect((await check({ reason: 'x' })).fields).toEqual(['cause']);
    expect((await check({})).fields).toEqual(['cause', 'reason']);
  });

  it.each([
    ['a\u0000b'],
    ['a\u001bb'],
    ['line\nbreak'],
    ['x\u0085y'],
    ['a\u007fb'],
  ])('refuses control characters in the reason %j', async (r) => {
    expect((await check({ ...ok, reason: r })).fields).toEqual(['reason']);
  });

  it('keeps accented, emoji and right-to-left text as written', async () => {
    const reason = 'Autorizație ăîșț 🚗 مرحبا';
    const { dto, fields } = await check({ ...ok, reason });
    expect(fields).toEqual([]);
    expect(dto.reason).toBe(reason);
  });

  it('counts 200 emoji as 200 characters', async () => {
    expect((await check({ ...ok, reason: '🚗'.repeat(200) })).fields).toEqual(
      [],
    );
  });

  it.each([
    ['Admin'],
    ['ADMIN'],
    [' admin'],
    [''],
    [null],
    [undefined],
    [1],
    [['admin']],
    ['constructor'],
    ['__proto__'],
    ['toString'],
    ['system'],
  ])('refuses the cause %j', async (cause) => {
    expect((await check({ ...ok, cause })).fields).toEqual(['cause']);
  });

  it.each(['recheck_failed', 'documents_overdue', 'admin', 'report_confirmed'])(
    'accepts the cause %s',
    async (cause) => {
      expect((await check({ ...ok, cause })).fields).toEqual([]);
    },
  );
});
