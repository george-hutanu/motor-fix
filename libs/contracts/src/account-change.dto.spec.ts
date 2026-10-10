import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  EmailChangeDto,
  PasswordChangeDto,
  PhoneChangeDto,
  PhoneConfirmDto,
} from './account-change.dto';
import { UpdateMeDto } from './me.dto';

// As the API's ValidationPipe checks a body: unknown fields refused.
function check<T extends object>(type: new () => T, body: object) {
  const dto = plainToInstance(type, body);
  const failed = validateSync(dto, {
    forbidNonWhitelisted: true,
    whitelist: true,
  }).map((error) => error.property);
  return { dto, failed };
}

// @traces 139-edit-my-details-FR-004
// @traces 139-edit-my-details-FR-005
describe('the name and city of my details', () => {
  it('takes a name and a city, trimmed, with no language', () => {
    const { dto, failed } = check(UpdateMeDto, {
      city: '  Cluj-Napoca ',
      name: '\t Andrei Marin ',
    });

    expect(failed).toEqual([]);
    expect(dto).toEqual({ city: 'Cluj-Napoca', name: 'Andrei Marin' });
  });

  it('still takes the language alone', () => {
    expect(check(UpdateMeDto, { language: 'en' }).failed).toEqual([]);
  });

  it('takes an empty body, which changes nothing', () => {
    expect(check(UpdateMeDto, {}).failed).toEqual([]);
  });

  it.each([
    ['2 characters', 'Al'],
    ['80 characters', 'A'.repeat(80)],
  ])('takes a name of %s', (_, name) => {
    expect(check(UpdateMeDto, { name }).failed).toEqual([]);
  });

  it.each([
    ['1 character', 'A'],
    ['1 character once trimmed', '  A  '],
    ['81 characters', 'A'.repeat(81)],
    ['a control character', 'Andrei\u0007'],
    ['a line break inside', 'Andrei\nMarin'],
    ['null', null],
    ['a number', 42],
  ])('refuses a name of %s', (_, name) => {
    expect(check(UpdateMeDto, { name }).failed).toEqual(['name']);
  });

  it.each([
    ['2 characters', 'Iș'],
    ['60 characters', 'C'.repeat(60)],
  ])('takes a city of %s', (_, city) => {
    expect(check(UpdateMeDto, { city }).failed).toEqual([]);
  });

  it.each([
    ['null', null],
    ['an empty text', ''],
    ['spaces only', '   '],
  ])('stores no city for %s', (_, city) => {
    const { dto, failed } = check(UpdateMeDto, { city });

    expect(failed).toEqual([]);
    expect(dto.city).toBeNull();
  });

  it.each([
    ['1 character', 'C'],
    ['61 characters', 'C'.repeat(61)],
    ['a control character', 'Cluj\u0000'],
    ['a number', 7],
  ])('refuses a city of %s', (_, city) => {
    expect(check(UpdateMeDto, { city }).failed).toEqual(['city']);
  });

  it('refuses an unknown field', () => {
    expect(
      check(UpdateMeDto, { name: 'Andrei', phone: '+40722123456' }).failed,
    ).toEqual(['phone']);
  });
});

// @traces 139-edit-my-details-FR-006
describe('a new e-mail address', () => {
  it('is trimmed and lower-cased', () => {
    const { dto, failed } = check(EmailChangeDto, {
      email: '  Andrei.Nou@Exemplu.RO ',
    });

    expect(failed).toEqual([]);
    expect(dto.email).toBe('andrei.nou@exemplu.ro');
  });

  it.each([
    ['no @', 'andrei.exemplu.ro'],
    ['no dot in the domain', 'andrei@exemplu'],
    ['a space inside', 'andrei nou@exemplu.ro'],
    ['more than 254 characters', `${'a'.repeat(250)}@x.ro`],
    ['nothing', ''],
  ])('is refused with %s', (_, email) => {
    expect(check(EmailChangeDto, { email }).failed).toEqual(['email']);
  });
});

// @traces 139-edit-my-details-FR-011
describe('a new phone number', () => {
  it('reads a Romanian mobile as typed', () => {
    const { dto, failed } = check(PhoneChangeDto, { phone: '0722 123 456' });

    expect(failed).toEqual([]);
    expect(dto.phone).toBe('+40722123456');
  });

  it('refuses a number that is not possible', () => {
    expect(check(PhoneChangeDto, { phone: '0722 ABC' }).failed).toEqual([
      'phone',
    ]);
  });

  it('takes six digits as the code', () => {
    expect(check(PhoneConfirmDto, { code: '012345' }).failed).toEqual([]);
  });

  it.each(['12345', '1234567', '12345a', ''])('refuses the code %p', (code) => {
    expect(check(PhoneConfirmDto, { code }).failed).toEqual(['code']);
  });
});

// @traces 139-edit-my-details-FR-014
// @traces 139-edit-my-details-FR-016
describe('a password change', () => {
  it('takes the current and the new password', () => {
    expect(
      check(PasswordChangeDto, {
        currentPassword: 'veche-parola',
        newPassword: 'noua-parola-lunga',
      }).failed,
    ).toEqual([]);
  });

  it('takes the new password alone, to set a first one', () => {
    expect(
      check(PasswordChangeDto, { newPassword: 'noua-parola-lunga' }).failed,
    ).toEqual([]);
  });

  it('refuses a body with no new password', () => {
    expect(
      check(PasswordChangeDto, { currentPassword: 'veche-parola' }).failed,
    ).toEqual(['newPassword']);
  });
});
