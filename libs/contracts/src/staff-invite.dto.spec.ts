import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { InviteTokenDto, StaffInviteDto } from './staff-invite.dto';

const problems = (dto: object) =>
  validateSync(dto, { forbidNonWhitelisted: true, whitelist: true }).map(
    (e) => e.property,
  );

const invite = (body: Record<string, unknown>) =>
  plainToInstance(StaffInviteDto, body);

// @traces 131-FR-001 131-FR-014
describe('StaffInviteDto', () => {
  it('trims the name and the e-mail and leaves the permissions off', () => {
    const dto = invite({
      email: '  Elena@Example.ro ',
      kind: 'mechanic',
      name: '\t Elena Stan  ',
    });

    expect(problems(dto)).toEqual([]);
    expect(dto.name).toBe('Elena Stan');
    expect(dto.email).toBe('Elena@Example.ro');
    expect(dto.canMoveBookings).toBe(false);
    expect(dto.canAnswerQuotes).toBe(false);
    expect(dto.canRecordFinalPrice).toBe(false);
  });

  it('takes a ticked permission as given', () => {
    const dto = invite({
      canAnswerQuotes: true,
      email: 'elena@example.ro',
      kind: 'mechanic',
      name: 'Elena Stan',
    });

    expect(problems(dto)).toEqual([]);
    expect(dto.canAnswerQuotes).toBe(true);
  });

  it.each([
    ['a one-letter name', { name: 'E' }, 'name'],
    ['a name over 80 characters', { name: 'E'.repeat(81) }, 'name'],
    ['a name with a control character', { name: 'Ele\u0000na' }, 'name'],
    ['an address without @', { email: 'elena.example.ro' }, 'email'],
    [
      'an address over 254 characters',
      { email: `${'e'.repeat(250)}@x.ro` },
      'email',
    ],
    ['an unknown kind', { kind: 'owner' }, 'kind'],
    [
      'a permission that is not a boolean',
      { canMoveBookings: 'yes' },
      'canMoveBookings',
    ],
  ])('refuses %s', (_, change, field) => {
    const dto = invite({
      email: 'elena@example.ro',
      kind: 'mechanic',
      name: 'Elena Stan',
      ...change,
    });

    expect(problems(dto)).toEqual([field]);
  });
});

describe('InviteTokenDto', () => {
  it.each([
    ['an empty token', ''],
    ['a token over 256 characters', 'a'.repeat(257)],
    ['a token that is not text', 42],
  ])('refuses %s', (_, token) => {
    expect(problems(plainToInstance(InviteTokenDto, { token }))).toEqual([
      'token',
    ]);
  });
});
