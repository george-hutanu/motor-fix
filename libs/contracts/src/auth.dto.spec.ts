import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { PhoneCodeDto, PhoneSignInDto, SignUpDto } from './auth.dto';
import { PRIVACY_VERSION, TERMS_VERSION } from './consent';

describe('SignUpDto', () => {
  it('trims the name and the email', () => {
    const dto = plainToInstance(SignUpDto, {
      email: '  ana@example.ro \n',
      name: '\t Ana Pop  ',
      password: 'x',
    });

    expect(dto.name).toBe('Ana Pop');
    expect(dto.email).toBe('ana@example.ro');
  });

  it('leaves a value that is not text as it came', () => {
    const dto = plainToInstance(SignUpDto, { email: 42, name: null });

    expect(dto.email).toBe(42);
    expect(dto.name).toBeNull();
  });
});

// As the API's ValidationPipe checks a body: unknown fields refused.
function check<T extends object>(
  type: new () => T,
  body: Record<string, unknown>,
) {
  const dto = plainToInstance(type, body);
  const failed = validateSync(dto, {
    forbidNonWhitelisted: true,
    whitelist: true,
  }).map((error) => error.property);
  return { dto, failed };
}

const consent = {
  privacyVersion: PRIVACY_VERSION,
  termsVersion: TERMS_VERSION,
};

describe('PhoneCodeDto', () => {
  it.each(['+40 722 123 456', '0722-123-456', '0040722123456'])(
    'reads %p as the E.164 number',
    (phone) => {
      const { dto, failed } = check(PhoneCodeDto, { phone });

      expect(failed).toEqual([]);
      expect(dto.phone).toBe('+40722123456');
    },
  );

  it.each([
    ['letters', '0722 ABC 456'],
    ['too few digits', '+40 72'],
    ['nothing', ''],
    ['more than 32 characters', `+40 722 123 456${' '.repeat(20)}`],
    ['a number, not text', 40722123456],
    ['no number at all', undefined],
  ])('refuses %s', (_, phone) => {
    expect(check(PhoneCodeDto, { phone }).failed).toEqual(['phone']);
  });

  it('takes ro or en as the language of the message, and nothing else', () => {
    const phone = '+40722123456';
    expect(check(PhoneCodeDto, { language: 'en', phone }).failed).toEqual([]);
    expect(check(PhoneCodeDto, { phone }).failed).toEqual([]);
    expect(check(PhoneCodeDto, { language: 'de', phone }).failed).toEqual([
      'language',
    ]);
  });

  it('refuses a field it does not know', () => {
    expect(
      check(PhoneCodeDto, { phone: '+40722123456', role: 'admin' }).failed,
    ).toEqual(['role']);
  });
});

describe('PhoneSignInDto', () => {
  const body = { code: '012345', phone: '0722 123 456' };

  it('takes the number and the code, and normalises the number', () => {
    const { dto, failed } = check(PhoneSignInDto, body);

    expect(failed).toEqual([]);
    expect(dto.phone).toBe('+40722123456');
    expect(dto.code).toBe('012345');
  });

  it.each(['12345', '1234567', '12345a', ' 123456', '１２３４５６', 123456])(
    'refuses the code %p, which is not six digits',
    (code) => {
      expect(check(PhoneSignInDto, { ...body, code }).failed).toEqual(['code']);
    },
  );

  it('refuses a number that is not possible', () => {
    expect(check(PhoneSignInDto, { ...body, phone: '0722' }).failed).toEqual([
      'phone',
    ]);
  });

  it('takes remember and the language, of the right kind', () => {
    expect(
      check(PhoneSignInDto, { ...body, language: 'en', remember: false })
        .failed,
    ).toEqual([]);
    expect(
      check(PhoneSignInDto, {
        ...body,
        language: 'fr',
        remember: 'yes',
      }).failed.sort(),
    ).toEqual(['language', 'remember']);
  });

  it('takes a trimmed name with the consent', () => {
    const { dto, failed } = check(PhoneSignInDto, {
      ...body,
      consent,
      name: '  Ana Pop ',
    });

    expect(failed).toEqual([]);
    expect(dto.name).toBe('Ana Pop');
  });

  it.each([
    ['one character', 'A'],
    ['81 characters', 'A'.repeat(81)],
    ['only spaces', '    '],
    ['a control character', 'Ana\u0007Pop'],
  ])('refuses a name of %s', (_, name) => {
    expect(check(PhoneSignInDto, { ...body, consent, name }).failed).toEqual([
      'name',
    ]);
  });

  it('refuses a name without the consent', () => {
    expect(check(PhoneSignInDto, { ...body, name: 'Ana Pop' }).failed).toEqual([
      'consent',
    ]);
  });

  it('refuses the consent without a name', () => {
    expect(check(PhoneSignInDto, { ...body, consent }).failed).toEqual([
      'name',
    ]);
  });

  it('refuses a field it does not know', () => {
    expect(check(PhoneSignInDto, { ...body, accountId: 'x' }).failed).toEqual([
      'accountId',
    ]);
  });
});
