import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { StaffInviteDto } from './staff-invite.dto';

const problems = (dto: object) =>
  validateSync(dto, { forbidNonWhitelisted: true, whitelist: true }).map(
    (e) => e.property,
  );
const make = (body: Record<string, unknown>) =>
  plainToInstance(StaffInviteDto, body);
const UUID = '3f2b8c1e-5a47-4d3e-9b1c-2a6f7e8d9c01';

describe('StaffInviteDto for a card and a phone', () => {
  it('accepts a card with a phone and no name', () => {
    expect(
      problems(
        make({ kind: 'mechanic', mechanicId: UUID, phone: '0722123456' }),
      ),
    ).toEqual([]);
  });

  it('normalises a Romanian number typed without a prefix to +40', () => {
    const dto = make({
      kind: 'mechanic',
      name: 'Elena',
      phone: '0722 123 456',
    });
    expect(problems(dto)).toEqual([]);
    expect(dto.phone).toBe('+40722123456');
  });

  it.each([
    ['neither address', { kind: 'mechanic', name: 'Elena' }],
    [
      'both addresses',
      { email: 'a@b.ro', kind: 'mechanic', name: 'Elena', phone: '0722123456' },
    ],
    [
      'a phone for a receptionist',
      { kind: 'receptionist', name: 'Elena', phone: '0722123456' },
    ],
    [
      'a card for a receptionist',
      { email: 'a@b.ro', kind: 'receptionist', mechanicId: UUID },
    ],
    [
      'a card that is not a UUID',
      { email: 'a@b.ro', kind: 'mechanic', mechanicId: 'abc' },
    ],
    [
      'a null card',
      { email: 'a@b.ro', kind: 'mechanic', mechanicId: null, name: 'Elena' },
    ],
    [
      'a null phone with no e-mail',
      { kind: 'mechanic', name: 'Elena', phone: null },
    ],
    ['an empty phone', { kind: 'mechanic', name: 'Elena', phone: '' }],
    [
      'letters in the phone',
      { kind: 'mechanic', name: 'Elena', phone: 'call me' },
    ],
    ['a numeric phone', { kind: 'mechanic', name: 'Elena', phone: 722123456 }],
    [
      'a phone array',
      { kind: 'mechanic', name: 'Elena', phone: ['+40722123456'] },
    ],
    [
      'a 40 digit phone',
      { kind: 'mechanic', name: 'Elena', phone: '1'.repeat(40) },
    ],
  ])('refuses %s', (_, body) => {
    expect(problems(make(body)).length).toBeGreaterThan(0);
  });

  it('refuses a card name that is present but one character long', () => {
    expect(
      problems(
        make({
          email: 'a@b.ro',
          kind: 'mechanic',
          mechanicId: UUID,
          name: 'E',
        }),
      ),
    ).toEqual(['name']);
  });

  it('refuses a null name beside a card', () => {
    expect(
      problems(
        make({
          email: 'a@b.ro',
          kind: 'mechanic',
          mechanicId: UUID,
          name: null,
        }),
      ),
    ).toEqual(['name']);
  });

  it('refuses a phone with a control character', () => {
    expect(
      problems(
        make({ kind: 'mechanic', name: 'Elena', phone: '+4072212\u00003456' }),
      ),
    ).toEqual(['phone']);
  });

  it('refuses an Arabic-Indic digit phone that is not E.164', () => {
    expect(
      problems(
        make({ kind: 'mechanic', name: 'Elena', phone: '+٤٠٧٢٢١٢٣٤٥٦' }),
      ),
    ).toEqual(['phone']);
  });

  it('refuses a null permission', () => {
    expect(
      problems(
        make({
          canMoveBookings: null,
          email: 'a@b.ro',
          kind: 'mechanic',
          name: 'Elena',
        }),
      ),
    ).toEqual(['canMoveBookings']);
  });
});
