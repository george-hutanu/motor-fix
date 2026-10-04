import { blockedReason, emailConfig } from './email-config';

describe('e-mail configuration', () => {
  it('keeps sending off by default, in every environment', () => {
    for (const env of [
      'development',
      'test',
      'staging',
      'production',
    ] as const) {
      const config = emailConfig(env, {});
      expect(config.sending).toBe(false);
      expect(blockedReason(config, 'ana@example.test')).toBe('sending_off');
    }
  });

  it('reads the switch, the sender, the key, the provider address and the webhook secret', () => {
    const config = emailConfig('staging', {
      BREVO_API_KEY: 'key',
      BREVO_API_URL: 'http://127.0.0.1:9/v3',
      BREVO_WEBHOOK_SECRET: 'secret',
      EMAIL_ALLOWLIST: 'ana@example.test',
      EMAIL_FROM: 'MotorFix <noreply@example.test>',
      EMAIL_SENDING: 'on',
    });
    expect(config).toMatchObject({
      apiKey: 'key',
      apiUrl: 'http://127.0.0.1:9/v3',
      from: { email: 'noreply@example.test', name: 'MotorFix' },
      sending: true,
      webhookSecret: 'secret',
    });
  });

  it('reads the web app address the e-mail buttons open, without a trailing slash', () => {
    expect(
      emailConfig('staging', { PUBLIC_WEB_URL: 'https://motorfix.test/' })
        .webUrl,
    ).toBe('https://motorfix.test');
    expect(emailConfig('staging', {}).webUrl).toBeUndefined();
  });

  it('talks to Brevo by default', () => {
    expect(emailConfig('production', {}).apiUrl).toBe(
      'https://api.brevo.com/v3',
    );
  });

  it('refuses a switch value other than on or off', () => {
    expect(() => emailConfig('test', { EMAIL_SENDING: 'yes' })).toThrow(
      /EMAIL_SENDING/,
    );
  });

  it('refuses a sender that is not an address when sending is on', () => {
    expect(() =>
      emailConfig('test', { EMAIL_FROM: 'MotorFix', EMAIL_SENDING: 'on' }),
    ).toThrow(/EMAIL_FROM/);
  });

  it('outside production sends only to listed addresses and domains', () => {
    const config = emailConfig('staging', {
      EMAIL_ALLOWLIST: 'Ana@Example.test, @motorfix.test',
      EMAIL_SENDING: 'on',
    });
    expect(blockedReason(config, 'ana@example.test')).toBeNull();
    expect(blockedReason(config, 'ion@motorfix.test')).toBeNull();
    expect(blockedReason(config, 'ION@MOTORFIX.TEST')).toBeNull();
    expect(blockedReason(config, 'ion@example.test')).toBe('not_allowed');
    expect(blockedReason(config, 'ion@evilmotorfix.test')).toBe('not_allowed');
  });

  it('outside production allows nobody when the list is empty', () => {
    const config = emailConfig('development', { EMAIL_SENDING: 'on' });
    expect(blockedReason(config, 'ana@example.test')).toBe('not_allowed');
  });

  it('in production ignores the list once sending is on', () => {
    const config = emailConfig('production', {
      EMAIL_ALLOWLIST: '@motorfix.test',
      EMAIL_SENDING: 'on',
    });
    expect(blockedReason(config, 'ana@example.test')).toBeNull();
  });
});
