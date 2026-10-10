import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  EmailChangeDto,
  PasswordChangeDto,
  PhoneChangeDto,
  PhoneConfirmDto,
} from './account-change.dto';
import { UpdateMeDto } from './me.dto';

function check<T extends object>(type: new () => T, body: unknown) {
  const dto = plainToInstance(type, body as object);
  const failed = validateSync(dto, {
    forbidNonWhitelisted: true,
    whitelist: true,
  }).map((error) => error.property);
  return { dto, failed };
}

describe('the e-mail change body, attacked', () => {
  const email = (value: unknown) => check(EmailChangeDto, { email: value });

  it('lower-cases and trims a shouting address', () => {
    const { dto, failed } = email('  ANDREI.Nou@Exemplu.RO\n');
    expect(failed).toEqual([]);
    expect(dto.email).toBe('andrei.nou@exemplu.ro');
  });

  it('accepts exactly 254 characters and refuses 255', () => {
    const at = (n: number) => `${'a'.repeat(n - 'x@b.co'.length)}x@b.co`;
    expect(email(at(254)).failed).toEqual([]);
    expect(email(at(255)).failed).toEqual(['email']);
  });

  it('measures the length after trimming', () => {
    const core = `${'a'.repeat(254 - 'x@b.co'.length)}x@b.co`;
    expect(email(`   ${core}   `).failed).toEqual([]);
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['no at sign', 'andrei.exemplu.ro'],
    ['no dot in the domain', 'andrei@exemplu'],
    ['two at signs', 'a@b@exemplu.ro'],
    ['an inner space', 'and rei@exemplu.ro'],
    ['an inner tab', 'andrei@exem\tplu.ro'],
    ['a newline inside', 'andrei@exemplu.ro\nbcc:x@y.zz'],
    ['a NUL', 'andrei\u0000@exemplu.ro'],
    ['a number', 12345],
    ['null', null],
    ['an array', ['a@b.co']],
    ['an object', { toString: () => 'a@b.co' }],
    ['a missing field', undefined],
  ])('refuses %s', (_, value) => {
    expect(email(value).failed).toEqual(['email']);
  });

  it('refuses a body with an extra field', () => {
    expect(
      check(EmailChangeDto, { accountId: 'x', email: 'a@b.co' }).failed,
    ).toEqual(['accountId']);
  });

  it('refuses a body that is an empty object', () => {
    expect(check(EmailChangeDto, {}).failed).toEqual(['email']);
  });

  it('lower-cases a unicode address the same way every time', () => {
    const { dto } = email('ȘTEFAN@EXEMPLU.RO');
    expect(dto.email).toBe('ștefan@exemplu.ro');
  });
});

describe('the phone change body, attacked', () => {
  const phone = (value: unknown) => check(PhoneChangeDto, { phone: value });

  it.each([
    ['0722 123 456', '+40722123456'],
    ['0722.123.456', '+40722123456'],
    ['(0722) 123-456', '+40722123456'],
    ['0040722123456', '+40722123456'],
    ['+400722123456', '+40722123456'],
    ['+40 722 123 456', '+40722123456'],
  ])('reads %s as %s', (typed, stored) => {
    const { dto, failed } = phone(typed);
    expect(failed).toEqual([]);
    expect(dto.phone).toBe(stored);
  });

  it.each([
    ['empty', ''],
    ['whitespace', '   '],
    ['letters', '0722 abc 456'],
    ['too short', '+12345'],
    ['too long', '+1234567890123456'],
    ['a leading +0', '+0722123456'],
    ['a plus in the middle', '0722+123456'],
    ['arabic-indic digits', '٠٧٢٢١٢٣٤٥٦'],
    ['fullwidth digits', '＋４０７２２１２３４５６'],
    ['a number type', 722123456],
    ['null', null],
    ['a missing field', undefined],
  ])('refuses %s', (_, value) => {
    expect(phone(value).failed).toEqual(['phone']);
  });

  it('refuses a 10 000 character string without hanging', () => {
    const started = Date.now();
    expect(phone('0'.repeat(10_000)).failed).toEqual(['phone']);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('refuses an extra field', () => {
    expect(check(PhoneChangeDto, { phone: '0722123456', x: 1 }).failed).toEqual(
      ['x'],
    );
  });
});

describe('the phone confirmation body, attacked', () => {
  const code = (value: unknown) => check(PhoneConfirmDto, { code: value });

  it('takes six digits, leading zeros kept', () => {
    const { dto, failed } = code('004217');
    expect(failed).toEqual([]);
    expect(dto.code).toBe('004217');
  });

  it.each([
    ['five digits', '12345'],
    ['seven digits', '1234567'],
    ['empty', ''],
    ['a space around', ' 123456 '],
    ['a trailing newline', '123456\n'],
    ['a space inside', '123 456'],
    ['letters', '12345a'],
    ['arabic-indic digits', '١٢٣٤٥٦'],
    ['a number', 123456],
    ['null', null],
    ['an array', ['123456']],
    ['a missing field', undefined],
  ])('refuses %s', (_, value) => {
    expect(code(value).failed).toEqual(['code']);
  });

  it('refuses an extra field', () => {
    expect(
      check(PhoneConfirmDto, { code: '123456', phone: '+1' }).failed,
    ).toEqual(['phone']);
  });
});

describe('the password change body, attacked', () => {
  const body = (value: unknown) => check(PasswordChangeDto, value);

  it('takes a new password alone', () => {
    expect(body({ newPassword: 'correct horse battery' }).failed).toEqual([]);
  });

  it('keeps spaces and unicode in a password untouched', () => {
    const { dto, failed } = body({
      currentPassword: '  pa ss  ',
      newPassword: '  parolă nouă ✓  ',
    });
    expect(failed).toEqual([]);
    expect(dto.newPassword).toBe('  parolă nouă ✓  ');
    expect(dto.currentPassword).toBe('  pa ss  ');
  });

  it('accepts 1024 characters and refuses 1025 in each field', () => {
    expect(body({ newPassword: 'a'.repeat(1024) }).failed).toEqual([]);
    expect(body({ newPassword: 'a'.repeat(1025) }).failed).toEqual([
      'newPassword',
    ]);
    expect(
      body({ currentPassword: 'a'.repeat(1025), newPassword: 'x'.repeat(10) })
        .failed,
    ).toEqual(['currentPassword']);
  });

  it.each([
    ['empty', { newPassword: '' }],
    ['missing', {}],
    ['null', { newPassword: null }],
    ['a number', { newPassword: 12345678 }],
    ['an array', { newPassword: ['abcdefgh'] }],
  ])('refuses a new password that is %s', (_, value) => {
    expect(body(value).failed).toEqual(['newPassword']);
  });

  it('refuses an empty current password rather than reading it as absent', () => {
    expect(
      body({ currentPassword: '', newPassword: 'correct horse battery' })
        .failed,
    ).toEqual(['currentPassword']);
  });

  it('refuses a null current password rather than reading it as absent', () => {
    expect(
      body({ currentPassword: null, newPassword: 'correct horse battery' })
        .failed,
    ).toEqual(['currentPassword']);
  });

  it('refuses a current password that is not text', () => {
    expect(
      body({ currentPassword: 12345678, newPassword: 'correct horse battery' })
        .failed,
    ).toEqual(['currentPassword']);
  });

  it('refuses an extra field such as an account id', () => {
    expect(
      body({ accountId: 'x', newPassword: 'correct horse battery' }).failed,
    ).toEqual(['accountId']);
  });
});

describe('the name and city of me, attacked', () => {
  const me = (value: object) => check(UpdateMeDto, value);

  it('accepts a name of exactly 2 and exactly 80, refuses 1 and 81', () => {
    expect(me({ name: 'Ab' }).failed).toEqual([]);
    expect(me({ name: 'a'.repeat(80) }).failed).toEqual([]);
    expect(me({ name: 'A' }).failed).toEqual(['name']);
    expect(me({ name: 'a'.repeat(81) }).failed).toEqual(['name']);
  });

  it('measures the name after trimming', () => {
    expect(me({ name: ` ${'a'.repeat(80)} ` }).failed).toEqual([]);
    expect(me({ name: ' a ' }).failed).toEqual(['name']);
    expect(me({ name: '     ' }).failed).toEqual(['name']);
  });

  it('accepts a city of exactly 2 and exactly 60, refuses 1 and 61', () => {
    expect(me({ city: 'Ab' }).failed).toEqual([]);
    expect(me({ city: 'a'.repeat(60) }).failed).toEqual([]);
    expect(me({ city: 'A' }).failed).toEqual(['city']);
    expect(me({ city: 'a'.repeat(61) }).failed).toEqual(['city']);
  });

  it('turns a blank or null city into null', () => {
    expect(me({ city: '   ' }).dto.city).toBeNull();
    expect(me({ city: null }).failed).toEqual([]);
    expect(me({ city: '' }).dto.city).toBeNull();
  });

  it.each([
    ['name', 'An\u0000drei'],
    ['name', 'An\ndrei'],
    ['name', 'An\tdrei'],
    ['name', 'An\u0085drei'],
    ['city', 'Clu\u0007j'],
    ['city', 'Clu\nj'],
  ])('refuses control characters in the %s %j', (field, value) => {
    expect(me({ [field]: value }).failed).toEqual([field]);
  });

  it('keeps diacritics and emoji in a name', () => {
    const { dto, failed } = me({ name: 'Ștefan Țurcanu 🚗' });
    expect(failed).toEqual([]);
    expect(dto.name).toBe('Ștefan Țurcanu 🚗');
  });

  it('refuses a null name rather than reading it as absent', () => {
    expect(me({ name: null }).failed).toEqual(['name']);
  });

  it('refuses a number as a name', () => {
    expect(me({ name: 12 }).failed).toEqual(['name']);
  });

  it('refuses an unknown language and an unknown field', () => {
    expect(me({ language: 'fr' }).failed).toEqual(['language']);
    expect(me({ language: 'RO' }).failed).toEqual(['language']);
    expect(me({ name: 'Andrei', role: 'admin' }).failed).toEqual(['role']);
    expect(me({ email: 'a@b.co' }).failed).toEqual(['email']);
  });
});
