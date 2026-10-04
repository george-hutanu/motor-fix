import { blockedReason, emailConfig } from './email-config';

const on = { EMAIL_SENDING: 'on' };

describe('e-mail configuration under hostile input', () => {
  it.each([
    'ON',
    'On',
    'true',
    '1',
    'yes',
    ' on',
    'on ',
    'off!',
  ])('refuses the switch value %j', (value) => {
    expect(() => emailConfig('test', { EMAIL_SENDING: value })).toThrow(
      /EMAIL_SENDING/,
    );
  });

  it('never turns sending on for an empty switch', () => {
    let sending: boolean;
    try {
      sending = emailConfig('test', { EMAIL_SENDING: '' }).sending;
    } catch {
      sending = false;
    }
    expect(sending).toBe(false);
  });

  it('keeps sending off for an undefined switch', () => {
    expect(
      emailConfig('production', { EMAIL_SENDING: undefined }).sending,
    ).toBe(false);
  });

  it('turns sending on only for the exact value on', () => {
    expect(emailConfig('production', on).sending).toBe(true);
    expect(emailConfig('production', { EMAIL_SENDING: 'off' }).sending).toBe(
      false,
    );
  });

  it('parses a sender without a display name', () => {
    const config = emailConfig('test', { EMAIL_FROM: 'noreply@example.test' });
    expect(config.from.email).toBe('noreply@example.test');
  });

  it('parses a sender whose name holds spaces and non-ASCII letters', () => {
    const config = emailConfig('test', {
      EMAIL_FROM: 'Mecanicul Șef <noreply@example.test>',
    });
    expect(config.from).toEqual({
      email: 'noreply@example.test',
      name: 'Mecanicul Șef',
    });
  });

  it('defaults the provider address when the variable is undefined', () => {
    expect(emailConfig('test', { BREVO_API_URL: undefined }).apiUrl).toBe(
      'https://api.brevo.com/v3',
    );
  });

  it('does not echo the key in an error', () => {
    expect.assertions(1);
    try {
      emailConfig('test', {
        BREVO_API_KEY: 'super-secret-key',
        EMAIL_SENDING: 'maybe',
      });
    } catch (e) {
      expect((e as Error).message).not.toContain('super-secret-key');
    }
  });
});

describe('who may be mailed', () => {
  it('reports sending_off before not_allowed when both apply', () => {
    const config = emailConfig('staging', { EMAIL_ALLOWLIST: '@x.test' });
    expect(blockedReason(config, 'ana@other.test')).toBe('sending_off');
  });

  it('reports sending_off in production when off', () => {
    expect(
      blockedReason(emailConfig('production', {}), 'ana@example.test'),
    ).toBe('sending_off');
  });

  it('allows any address in production once on', () => {
    expect(
      blockedReason(emailConfig('production', on), 'anyone@example.test'),
    ).toBeNull();
  });

  it.each([
    'development',
    'test',
    'staging',
  ] as const)('allows nobody in %s with an empty, blank or comma-only list', (env) => {
    for (const list of [undefined, '', '  ', ',', ' , ,']) {
      const config = emailConfig(env, { ...on, EMAIL_ALLOWLIST: list });
      expect(blockedReason(config, 'ana@example.test')).toBe('not_allowed');
      expect(blockedReason(config, '')).toBe('not_allowed');
    }
  });

  it('does not let a bare @ entry allow everybody', () => {
    const config = emailConfig('staging', { ...on, EMAIL_ALLOWLIST: '@' });
    expect(blockedReason(config, 'ana@example.test')).toBe('not_allowed');
  });

  it('does not match a domain entry against a subdomain or a lookalike', () => {
    const config = emailConfig('staging', {
      ...on,
      EMAIL_ALLOWLIST: '@motorfix.test',
    });
    expect(blockedReason(config, 'a@sub.motorfix.test')).toBe('not_allowed');
    expect(blockedReason(config, 'a@motorfix.test.evil.example')).toBe(
      'not_allowed',
    );
    expect(blockedReason(config, 'motorfix.test@evil.example')).toBe(
      'not_allowed',
    );
  });

  it('does not match an exact entry as a suffix or prefix', () => {
    const config = emailConfig('staging', {
      ...on,
      EMAIL_ALLOWLIST: 'ana@example.test',
    });
    expect(blockedReason(config, 'bana@example.test')).toBe('not_allowed');
    expect(blockedReason(config, 'ana@example.test.evil')).toBe('not_allowed');
    expect(blockedReason(config, 'ana@example.test')).toBeNull();
  });

  it('ignores whitespace around entries', () => {
    const config = emailConfig('staging', {
      ...on,
      EMAIL_ALLOWLIST: '  ana@example.test ,\t@motorfix.test\n',
    });
    expect(blockedReason(config, 'ana@example.test')).toBeNull();
    expect(blockedReason(config, 'z@motorfix.test')).toBeNull();
  });

  it('matches case-insensitively in both directions', () => {
    const config = emailConfig('staging', {
      ...on,
      EMAIL_ALLOWLIST: 'ANA@EXAMPLE.TEST,@MotorFix.Test',
    });
    expect(blockedReason(config, 'ana@example.test')).toBeNull();
    expect(blockedReason(config, 'Z@motorfix.TEST')).toBeNull();
  });

  it('does not treat list characters as a pattern', () => {
    const config = emailConfig('staging', {
      ...on,
      EMAIL_ALLOWLIST: '*@example.test,.*',
    });
    expect(blockedReason(config, 'ana@example.test')).toBe('not_allowed');
  });
});
