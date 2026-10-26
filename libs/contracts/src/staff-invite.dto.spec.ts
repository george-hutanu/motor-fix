import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  InviteTokenDto,
  InviteViewDto,
  StaffInviteDto,
} from './staff-invite.dto';

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

// @traces 1255-FR-001 1255-FR-002
describe('StaffInviteDto, by phone or from a card', () => {
  const CARD = '6f1c2b4e-8a3d-4c5e-9f7a-1b2c3d4e5f60';

  it('reads a Romanian number without a prefix as +40', () => {
    const dto = invite({
      kind: 'mechanic',
      name: 'Elena Stan',
      phone: '0722 000 111',
    });

    expect(problems(dto)).toEqual([]);
    expect(dto.phone).toBe('+40722000111');
    expect(dto.email).toBeUndefined();
  });

  it('takes a card without a name, the name coming from the card', () => {
    const dto = invite({
      email: 'elena@example.ro',
      kind: 'mechanic',
      mechanicId: CARD,
    });

    expect(problems(dto)).toEqual([]);
    expect(dto.mechanicId).toBe(CARD);
  });

  it('still needs a name without a card', () => {
    expect(
      problems(invite({ email: 'elena@example.ro', kind: 'mechanic' })),
    ).toEqual(['name']);
  });

  it.each([
    [
      'both an e-mail and a phone',
      { email: 'elena@example.ro', phone: '+40722000111' },
    ],
    ['neither an e-mail nor a phone', {}],
  ])('refuses %s', (_, address) => {
    const dto = invite({ kind: 'mechanic', name: 'Elena Stan', ...address });

    expect(problems(dto)).not.toEqual([]);
  });

  it.each([
    ['a phone that is not a number', { phone: 'not a phone' }, 'phone'],
    ['a phone over 20 characters', { phone: `+40${'7'.repeat(20)}` }, 'phone'],
    [
      'a phone for a receptionist',
      { kind: 'receptionist', phone: '+40722000111' },
      'phone',
    ],
    [
      'a card that is not a UUID',
      { email: 'elena@example.ro', mechanicId: 'card-1' },
      'mechanicId',
    ],
    [
      'a card for a receptionist',
      { email: 'ioana@example.ro', kind: 'receptionist', mechanicId: CARD },
      'mechanicId',
    ],
  ])('refuses %s', (_, change, field) => {
    const dto = invite({ kind: 'mechanic', name: 'Elena Stan', ...change });

    expect(problems(dto)).toEqual([field]);
  });
});

// @traces 1255-FR-009
describe('InviteViewDto', () => {
  it('describes the phone, the e-mail and the garage being left, each nullable', () => {
    const properties: string[] =
      Reflect.getMetadata(
        'swagger/apiModelPropertiesArray',
        InviteViewDto.prototype,
      ) ?? [];
    const nullable = (name: string) =>
      Reflect.getMetadata(
        'swagger/apiModelProperties',
        InviteViewDto.prototype,
        name,
      )?.nullable;

    expect(properties).toEqual(
      expect.arrayContaining([':email', ':phone', ':leaving']),
    );
    expect(['email', 'phone', 'leaving'].map(nullable)).toEqual([
      true,
      true,
      true,
    ]);
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
