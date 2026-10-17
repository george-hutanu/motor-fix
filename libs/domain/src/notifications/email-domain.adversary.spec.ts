import {
  emailConfig,
  emailEnvelope,
  sendingDomain,
  supportAddress,
} from './email-config';

// @traces 279-FR-001
describe('the sending domain setting under hostile values', () => {
  it.each([
    ['https://mail.example.test'],
    ['mail.example.test/path'],
    ['mail.example.test:8080'],
    ['a@mail.example.test'],
    ['mail example.test'],
    ['localhost'],
    ['example'],
    ['.example.test'],
    ['-a.example.test'],
    ['a_b.example.test'],
    ['1.2.3.4'],
    ['mail.example.test\nbcc.evil.test'],
    ['bücher.example'],
    [''],
    ['   '],
  ])('reads %j as no domain', (value) => {
    expect(sendingDomain({ EMAIL_DOMAIN: value })).toBeUndefined();
  });

  it.each([
    ['  Mail.Example.TEST  ', 'mail.example.test'],
    ['example.test', 'example.test'],
    ['a.b.c.d.example.test', 'a.b.c.d.example.test'],
  ])('reads %j as %s', (value, expected) => {
    expect(sendingDomain({ EMAIL_DOMAIN: value })).toBe(expected);
  });

  it('reads an unset domain as none', () => {
    expect(sendingDomain({})).toBeUndefined();
  });

  it('refuses a malformed domain when sending is on', () => {
    expect(() =>
      emailConfig('staging', {
        EMAIL_DOMAIN: 'https://mail.example.test',
        EMAIL_SENDING: 'on',
      }),
    ).toThrow(/EMAIL_DOMAIN/);
  });

  it('ignores a malformed domain when sending is off', () => {
    const config = emailConfig('staging', {
      EMAIL_DOMAIN: 'mail example.test',
      EMAIL_FROM: 'MotorFix <no-reply@anywhere.test>',
    });
    expect(config.domain).toBeUndefined();
    expect(config.replyTo).toBeUndefined();
    expect(config.from.email).toBe('no-reply@anywhere.test');
  });

  it('keeps no domain, no reply-to and the plain sender when nothing is set', () => {
    const config = emailConfig('staging', {});
    expect(config.domain).toBeUndefined();
    expect(config.replyTo).toBeUndefined();
  });
});

// @traces 279-FR-002
describe('the sender derived from the domain under hostile values', () => {
  const on = { EMAIL_DOMAIN: 'mail.example.test', EMAIL_SENDING: 'on' };

  it('derives the MotorFix no-reply sender from the domain', () => {
    expect(emailConfig('staging', on).from).toEqual({
      email: 'no-reply@mail.example.test',
      name: 'MotorFix',
    });
  });

  it('lower-cases a mixed-case domain in the derived sender', () => {
    expect(
      emailConfig('staging', { ...on, EMAIL_DOMAIN: 'Mail.EXAMPLE.test' }).from
        .email,
    ).toBe('no-reply@mail.example.test');
  });

  it('treats a whitespace-only EMAIL_FROM as unset', () => {
    expect(
      emailConfig('staging', { ...on, EMAIL_FROM: '   ' }).from.email,
    ).toBe('no-reply@mail.example.test');
  });

  it.each([
    ['MotorFix <no-reply@sub.mail.example.test>'],
    ['MotorFix <no-reply@example.test>'],
    ['MotorFix <no-reply@mail.example.test.evil.test>'],
    ['MotorFix <no-reply@evilmail.example.test>'],
    ['no-reply@other.test'],
  ])('refuses %s with sending on, naming both settings', (from) => {
    expect(() => emailConfig('staging', { ...on, EMAIL_FROM: from })).toThrow(
      /EMAIL_FROM.*EMAIL_DOMAIN|EMAIL_DOMAIN.*EMAIL_FROM/,
    );
  });

  it('accepts an EMAIL_FROM host in other case', () => {
    expect(
      emailConfig('staging', {
        ...on,
        EMAIL_FROM: 'MotorFix <No-Reply@MAIL.Example.TEST>',
      }).from.email,
    ).toBe('No-Reply@MAIL.Example.TEST');
  });

  it('accepts an EMAIL_FROM on the domain without a display name', () => {
    expect(
      emailConfig('staging', { ...on, EMAIL_FROM: 'hello@mail.example.test' })
        .from,
    ).toEqual({ email: 'hello@mail.example.test', name: 'MotorFix' });
  });

  it('does not hold EMAIL_FROM to the domain when sending is off', () => {
    expect(
      emailConfig('staging', {
        EMAIL_DOMAIN: 'mail.example.test',
        EMAIL_FROM: 'MotorFix <no-reply@other.test>',
      }).from.email,
    ).toBe('no-reply@other.test');
  });

  it('does not hold SUPPORT_EMAIL to the domain', () => {
    expect(
      emailConfig('staging', { ...on, SUPPORT_EMAIL: 'help@elsewhere.test' })
        .replyTo,
    ).toEqual({ email: 'help@elsewhere.test', name: 'MotorFix' });
  });

  it('refuses an unknown sending switch', () => {
    expect(() => emailConfig('staging', { EMAIL_SENDING: 'ON' })).toThrow(
      /EMAIL_SENDING/,
    );
  });
});

// @traces 279-FR-003
describe('the support address under hostile values', () => {
  const domain = { EMAIL_DOMAIN: 'mail.example.test' };

  it('prefers SUPPORT_EMAIL over the domain', () => {
    expect(supportAddress({ ...domain, SUPPORT_EMAIL: 'help@x.test' })).toBe(
      'help@x.test',
    );
  });

  it('falls back to support at the domain when SUPPORT_EMAIL is empty', () => {
    expect(supportAddress({ ...domain, SUPPORT_EMAIL: '' })).toBe(
      'support@mail.example.test',
    );
  });

  it.each([['not an address'], ['help@'], ['@x.test'], ['a b@x.test']])(
    'falls back to the domain for the non-address %j',
    (value) => {
      expect(supportAddress({ ...domain, SUPPORT_EMAIL: value })).toBe(
        'support@mail.example.test',
      );
    },
  );

  it('gives none when neither is usable', () => {
    expect(supportAddress({ SUPPORT_EMAIL: 'garbage' })).toBeUndefined();
    expect(supportAddress({})).toBeUndefined();
  });

  it('trims a padded SUPPORT_EMAIL', () => {
    expect(supportAddress({ SUPPORT_EMAIL: '  help@x.test  ' })).toBe(
      'help@x.test',
    );
  });

  it('gives support at the domain from the domain alone', () => {
    expect(supportAddress(domain)).toBe('support@mail.example.test');
  });

  it('puts the support address in the configured reply-to', () => {
    expect(emailConfig('staging', domain).replyTo).toEqual({
      email: 'support@mail.example.test',
      name: 'MotorFix',
    });
  });
});

// @traces 279-FR-004
describe('the envelope under hostile params', () => {
  const config = emailConfig('staging', { EMAIL_DOMAIN: 'mail.example.test' });
  const bare = emailConfig('staging', {});
  const to = { email: 'a@example.test' };

  it('sets sender, reply-to and recipient and no headers for plain params', () => {
    expect(emailEnvelope(config, to, { name: 'x' })).toEqual({
      from: config.from,
      replyTo: config.replyTo,
      to,
    });
  });

  it('sets no reply-to key when none is configured', () => {
    const envelope = emailEnvelope(bare, to);
    expect(Object.keys(envelope)).not.toContain('replyTo');
    expect(Object.keys(envelope)).not.toContain('headers');
  });

  it('sets the one-click headers from a string link', () => {
    expect(
      emailEnvelope(config, to, { oneClick: 'https://web.example.test/u/1' })
        .headers,
    ).toEqual({
      'List-Unsubscribe': '<https://web.example.test/u/1>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
  });

  it.each([[null], [undefined], [42], [true], [{}], [['https://x.test']]])(
    'sets no headers for the non-string link %j',
    (oneClick) => {
      expect(emailEnvelope(config, to, { oneClick })).not.toHaveProperty(
        'headers',
      );
    },
  );

  it('keeps the recipient name', () => {
    expect(
      emailEnvelope(config, { email: 'a@example.test', name: 'Ana' }).to,
    ).toEqual({ email: 'a@example.test', name: 'Ana' });
  });

  it('does not change the params it reads', () => {
    const params = Object.freeze({ oneClick: 'https://web.example.test/u/1' });
    expect(emailEnvelope(config, to, params)).toEqual(
      emailEnvelope(config, to, params),
    );
  });
});
