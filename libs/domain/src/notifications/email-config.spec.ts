import { Logger } from '@nestjs/common';

import {
  blockedReason,
  emailConfig,
  emailEnvelope,
  sendingDomain,
  supportAddress,
} from './email-config';

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
    expect(
      emailConfig('staging', { PUBLIC_WEB_URL: 'motorfix.test' }).webUrl,
    ).toBeUndefined();
  });

  it('reads the address as the web server does, so stray spaces never reach a button', () => {
    expect(
      emailConfig('staging', { PUBLIC_WEB_URL: ' https://motorfix.test/ ' })
        .webUrl,
    ).toBe('https://motorfix.test');
    expect(
      emailConfig('staging', { PUBLIC_WEB_URL: 'https://motorfix.test/app/' })
        .webUrl,
    ).toBe('https://motorfix.test/app');
  });

  it('loads without an address when it is empty or not a URL, rather than stopping', () => {
    expect(
      emailConfig('staging', { PUBLIC_WEB_URL: '' }).webUrl,
    ).toBeUndefined();
    expect(
      emailConfig('staging', { PUBLIC_WEB_URL: 'secret-host' }).webUrl,
    ).toBeUndefined();
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

// @traces 279-email-inbox-FR-001
describe('the sending domain', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reads EMAIL_DOMAIN trimmed and lower-cased', () => {
    expect(sendingDomain({ EMAIL_DOMAIN: ' Mail.Example.TEST ' })).toBe(
      'mail.example.test',
    );
    expect(
      emailConfig('staging', { EMAIL_DOMAIN: 'Example.test' }).domain,
    ).toBe('example.test');
    expect(emailConfig('staging', {}).domain).toBeUndefined();
  });

  it.each([
    'https://example.test',
    'example.test/path',
    'mail@example.test',
    'mail example.test',
    'localhost',
    'example.',
    '-bad.example.test',
  ])('refuses EMAIL_DOMAIN=%p at start with sending on', (value) => {
    expect(sendingDomain({ EMAIL_DOMAIN: value })).toBeUndefined();
    expect(() =>
      emailConfig('staging', { EMAIL_DOMAIN: value, EMAIL_SENDING: 'on' }),
    ).toThrow(/EMAIL_DOMAIN/);
  });

  it('drops a bad EMAIL_DOMAIN with a warning while sending is off', () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const config = emailConfig('staging', { EMAIL_DOMAIN: 'not a domain' });
    expect(config.domain).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('EMAIL_DOMAIN'));
  });
});

// @traces 279-email-inbox-FR-002
describe('the sender the domain gives', () => {
  it('sends as MotorFix no-reply at the domain when EMAIL_FROM is unset', () => {
    expect(
      emailConfig('staging', {
        EMAIL_DOMAIN: 'example.test',
        EMAIL_SENDING: 'on',
      }).from,
    ).toEqual({ email: 'no-reply@example.test', name: 'MotorFix' });
  });

  it('accepts an EMAIL_FROM on exactly the domain, whatever its case', () => {
    expect(
      emailConfig('staging', {
        EMAIL_DOMAIN: 'example.test',
        EMAIL_FROM: 'MotorFix <News@Example.TEST>',
        EMAIL_SENDING: 'on',
      }).from,
    ).toEqual({ email: 'News@Example.TEST', name: 'MotorFix' });
  });

  it.each([
    'MotorFix <no-reply@other.test>',
    'no-reply@mail.example.test',
    'no-reply@evilexample.test',
  ])('refuses EMAIL_FROM=%p off the domain with sending on', (from) => {
    expect(() =>
      emailConfig('staging', {
        EMAIL_DOMAIN: 'example.test',
        EMAIL_FROM: from,
        EMAIL_SENDING: 'on',
      }),
    ).toThrow(/EMAIL_FROM.*EMAIL_DOMAIN/);
  });

  it('accepts a sender off the domain while sending is off', () => {
    expect(
      emailConfig('staging', {
        EMAIL_DOMAIN: 'example.test',
        EMAIL_FROM: 'no-reply@other.test',
      }).from.email,
    ).toBe('no-reply@other.test');
  });

  it("keeps today's sender when no domain is set", () => {
    expect(
      emailConfig('staging', {
        EMAIL_FROM: 'MotorFix <noreply@other.test>',
        EMAIL_SENDING: 'on',
      }).from,
    ).toEqual({ email: 'noreply@other.test', name: 'MotorFix' });
    expect(emailConfig('staging', {}).from.email).toBe('');
  });
});

// @traces 279-email-inbox-FR-003
describe('the support address', () => {
  it('is SUPPORT_EMAIL when it is an address, on any domain', () => {
    expect(
      supportAddress({
        EMAIL_DOMAIN: 'example.test',
        SUPPORT_EMAIL: ' help@elsewhere.test ',
      }),
    ).toBe('help@elsewhere.test');
  });

  it('is support at the domain when SUPPORT_EMAIL is unset or no address', () => {
    expect(supportAddress({ EMAIL_DOMAIN: 'Example.test' })).toBe(
      'support@example.test',
    );
    expect(
      supportAddress({ EMAIL_DOMAIN: 'example.test', SUPPORT_EMAIL: 'help' }),
    ).toBe('support@example.test');
  });

  it('is none with neither', () => {
    expect(supportAddress({})).toBeUndefined();
    expect(supportAddress({ EMAIL_DOMAIN: 'not a domain' })).toBeUndefined();
  });

  it('is the reply-to of the configuration', () => {
    expect(
      emailConfig('staging', { EMAIL_DOMAIN: 'example.test' }).replyTo,
    ).toEqual({ email: 'support@example.test', name: 'MotorFix' });
    expect(emailConfig('staging', {}).replyTo).toBeUndefined();
  });
});

// @traces 279-email-inbox-FR-004 279-email-inbox-FR-011
describe('the envelope of every automatic e-mail', () => {
  const to = { email: 'ana@example.test', name: 'Ana' };

  it('carries the sender, the recipient and the support reply-to', () => {
    const config = emailConfig('staging', { EMAIL_DOMAIN: 'example.test' });
    expect(emailEnvelope(config, to)).toEqual({
      from: { email: 'no-reply@example.test', name: 'MotorFix' },
      replyTo: { email: 'support@example.test', name: 'MotorFix' },
      to,
    });
  });

  it('carries no reply-to when no support address is configured', () => {
    const envelope = emailEnvelope(emailConfig('staging', {}), to);
    expect(envelope).not.toHaveProperty('replyTo');
    expect(envelope).not.toHaveProperty('headers');
  });

  it('adds the one-click pair only for a one-click link', () => {
    const config = emailConfig('staging', { EMAIL_DOMAIN: 'example.test' });
    const link = 'https://motorfix.test/api/v1/unsubscribe?token=t';
    expect(emailEnvelope(config, to, { oneClick: link }).headers).toEqual({
      'List-Unsubscribe': `<${link}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
    expect(emailEnvelope(config, to, { oneClick: 7 })).not.toHaveProperty(
      'headers',
    );
    expect(emailEnvelope(config, to, { title: 'x' })).not.toHaveProperty(
      'headers',
    );
  });
});
