import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { InviteTokenDto, StaffInviteDto } from './staff-invite.dto';

const problems = (dto: object) =>
  validateSync(dto, { forbidNonWhitelisted: true, whitelist: true }).map(
    (e) => e.property,
  );

const base = { email: 'elena@example.ro', kind: 'mechanic', name: 'Elena' };
const invite = (over: Record<string, unknown>) =>
  plainToInstance(StaffInviteDto, { ...base, ...over });
const token = (body: unknown) => plainToInstance(InviteTokenDto, body);

describe('StaffInviteDto under hostile input', () => {
  it.each([
    ['one character', 'E', ['name']],
    ['two characters', 'Al', []],
    ['eighty characters', 'a'.repeat(80), []],
    ['eighty-one characters', 'a'.repeat(81), ['name']],
    ['only spaces', '     ', ['name']],
    ['a line break inside', 'Elena\nStan', ['name']],
    ['a NUL byte', 'Elena\u0000Stan', ['name']],
    ['a tab inside', 'Elena\tStan', ['name']],
  ])('name of %s', (_, name, expected) => {
    expect(problems(invite({ name }))).toEqual(expected);
  });

  it('counts a name of eighty emoji as eighty characters', () => {
    expect(problems(invite({ name: '😀'.repeat(80) }))).toEqual([]);
  });

  it('accepts Romanian diacritics in the name', () => {
    expect(problems(invite({ name: 'Ștefan Țurcanu' }))).toEqual([]);
  });

  it.each([
    ['not a string', 42, ['name']],
    ['null', null, ['name']],
    ['an array', ['Elena'], ['name']],
  ])('name that is %s', (_, name, expected) => {
    expect(problems(invite({ name }))).toEqual(expected);
  });

  it('refuses a missing name', () => {
    const { name: _n, ...rest } = base;
    expect(problems(plainToInstance(StaffInviteDto, rest))).toEqual(['name']);
  });

  it('accepts an address of exactly 254 characters and refuses 255', () => {
    const at = (n: number) => `${'a'.repeat(n - 8)}@bb.ccc`.padEnd(n, 'c');
    expect(at(254)).toHaveLength(254);
    expect(problems(invite({ email: at(254) }))).toEqual([]);
    expect(problems(invite({ email: at(255) }))).toEqual(['email']);
  });

  it.each([
    'elena',
    'elena@',
    '@example.ro',
    'elena@example',
    'el ena@example.ro',
    'a@b@c.ro',
    'elena@example.ro\r\nBcc: x@y.z',
    'elena@exa\u0000mple.ro',
    '',
  ])('refuses the address %j', (email) => {
    expect(problems(invite({ email }))).toEqual(['email']);
  });

  it('trims an address padded with line breaks', () => {
    const dto = invite({ email: '\n elena@example.ro \t' });
    expect(problems(dto)).toEqual([]);
    expect(dto.email).toBe('elena@example.ro');
  });

  it.each([
    ['owner', 'owner'],
    ['upper case', 'MECHANIC'],
    ['empty', ''],
    ['null', null],
    ['a number', 1],
  ])('refuses kind %s', (_, kind) => {
    expect(problems(invite({ kind }))).toEqual(['kind']);
  });

  it.each([
    ['"true"', 'true'],
    ['1', 1],
    ['null', null],
  ])('refuses a permission given as %s', (_, value) => {
    const flagged = problems(invite({ canMoveBookings: value }));
    expect(flagged).toEqual(['canMoveBookings']);
  });

  it('refuses a member the contract does not name', () => {
    expect(problems(invite({ role: 'owner' }))).toEqual(['role']);
    expect(problems(invite({ garageId: 'x' }))).toEqual(['garageId']);
  });

  it('keeps permissions off when none are sent', () => {
    const dto = invite({});
    expect([
      dto.canAnswerQuotes,
      dto.canMoveBookings,
      dto.canRecordFinalPrice,
    ]).toEqual([false, false, false]);
  });
});

describe('InviteTokenDto under hostile input', () => {
  it.each([
    ['one character', 'a', []],
    ['256 characters', 'a'.repeat(256), []],
    ['257 characters', 'a'.repeat(257), ['token']],
    ['empty', '', ['token']],
  ])('token of %s', (_, value, expected) => {
    expect(problems(token({ token: value }))).toEqual(expected);
  });

  it.each([[null], [42], [['abc']], [{ a: 1 }], [undefined]])(
    'refuses a token that is %j',
    (value) => {
      expect(problems(token({ token: value }))).toEqual(['token']);
    },
  );

  it('refuses an extra member', () => {
    expect(problems(token({ extra: 1, token: 'abc' }))).toEqual(['extra']);
  });
});
