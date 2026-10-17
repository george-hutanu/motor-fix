import { inboxMailboxes, runInboxTest } from './inbox-test';
import type { Brevo } from '../brevo/brevo';
import { emailConfig } from '../email-config';
import type { Registry, Template } from '../templates';
import { TEMPLATES } from '../templates/registry';

type Sent = Parameters<Brevo['send']>[0];

const WEB = 'https://staging.example.test';
const SETTINGS: Record<string, string> = {
  BREVO_API_KEY: 'key',
  EMAIL_ALLOWLIST: '@example.test',
  EMAIL_DOMAIN: 'mail.example.test',
  EMAIL_SENDING: 'on',
  PUBLIC_WEB_URL: WEB,
};
const WITH_EMAIL = Object.entries(TEMPLATES).filter(([, t]) => t.email);

async function run(
  options: {
    appEnv?: 'staging' | 'production';
    settings?: Record<string, string>;
    mailboxes?: string[];
    dryRun?: boolean;
    registry?: Registry;
    send?: (mail: Sent) => Promise<string>;
  } = {},
) {
  const sent: Sent[] = [];
  const printed: string[] = [];
  const code = await runInboxTest({
    config: emailConfig(
      options.appEnv ?? 'staging',
      options.settings ?? SETTINGS,
    ),
    dryRun: options.dryRun ?? false,
    mailboxes: options.mailboxes ?? ['a@example.test'],
    print: (line) => printed.push(line),
    registry: options.registry,
    send:
      options.send ??
      ((mail) => {
        sent.push(mail);
        return Promise.resolve(`<id-${sent.length}@brevo>`);
      }),
  });
  return { code, printed, sent };
}

function template(subject: string, line = 'hello'): Template {
  return {
    audience: 'any',
    email: {
      en: {
        button: { label: 'Open', link: 'app' },
        lines: [line],
        reason: 'r',
        subject,
      },
      ro: {
        button: { label: 'Deschide', link: 'app' },
        lines: [line],
        reason: 'r',
        subject,
      },
    },
    example: { app: 'https://motorfix.example/x' },
    values: { app: 'link' },
  };
}

// @traces 279-FR-007
describe('the inbox mailbox list under hostile values', () => {
  it.each([[''], [' '], [','], [' , ,, '], [undefined]])(
    'reads %j as no mailbox',
    (value) => {
      expect(inboxMailboxes(value)).toEqual([]);
    },
  );

  it('keeps first-seen order and drops case-variant duplicates', () => {
    expect(inboxMailboxes('B@x.test,a@x.test,b@X.TEST,A@x.test')).toEqual([
      'b@x.test',
      'a@x.test',
    ]);
  });

  it('reads tabs and newlines around an address as padding', () => {
    expect(inboxMailboxes('\ta@x.test\n,\r\nb@x.test')).toEqual([
      'a@x.test',
      'b@x.test',
    ]);
  });
});

// @traces 279-FR-009
describe('the dry run under hostile setups', () => {
  it('prints nothing and sends nothing without mailboxes', async () => {
    const { printed, sent } = await run({ dryRun: true, mailboxes: [] });
    expect(printed).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('prints one row per template, language and mailbox with a subject', async () => {
    const { code, printed } = await run({
      dryRun: true,
      mailboxes: ['a@example.test', 'b@example.test', 'c@example.test'],
    });
    expect(code).toBe(0);
    expect(printed).toHaveLength(WITH_EMAIL.length * 2 * 3);
    expect(new Set(printed).size).toBe(printed.length);
    for (const line of printed) expect(line).not.toMatch(/FAILED/);
  });

  it('prints the good rows and fails the run when one template is broken', async () => {
    const broken: Template = {
      ...template('s', '{missing}'),
      example: {},
      values: {},
    };
    const { code, printed } = await run({
      dryRun: true,
      registry: { BROKEN: broken, GOOD: template('Hi') },
    });
    expect(code).toBe(1);
    expect(printed.filter((l) => l.includes('FAILED'))).toHaveLength(2);
    expect(printed).toContainEqual(
      expect.stringMatching(/^GOOD ro a@example\.test Hi/),
    );
    expect(printed).toContainEqual(
      expect.stringMatching(/^GOOD en a@example\.test Hi/),
    );
  });

  it('skips a template that has no e-mail', async () => {
    const { printed } = await run({
      dryRun: true,
      registry: {
        BELL_ONLY: { audience: 'any', example: {}, values: {} },
        GOOD: template('Hi'),
      },
    });
    expect(printed.every((l) => l.startsWith('GOOD '))).toBe(true);
    expect(printed).toHaveLength(2);
  });

  it('sends nothing from a dry run even with every setting present', async () => {
    const { sent } = await run({ dryRun: true });
    expect(sent).toEqual([]);
  });

  it('renders links on the web app with no doubled slash for a trailing slash', async () => {
    const { sent } = await run({
      settings: { ...SETTINGS, PUBLIC_WEB_URL: `${WEB}/` },
    });
    for (const mail of sent) {
      expect(mail.html).not.toContain(`${WEB}//`);
      expect(mail.html).not.toContain('motorfix.example');
    }
  });
});

// @traces 279-FR-010
describe('the real run under hostile setups', () => {
  it('sends nothing to anyone when one of two mailboxes is blocked', async () => {
    const { code, printed, sent } = await run({
      mailboxes: ['a@example.test', 'x@evil.test'],
    });
    expect(code).toBe(1);
    expect(sent).toEqual([]);
    expect(printed.join('\n')).toContain('x@evil.test');
  });

  it('refuses outside production when the allowlist is empty', async () => {
    const { code, sent } = await run({
      settings: { ...SETTINGS, EMAIL_ALLOWLIST: '' },
    });
    expect(code).toBe(1);
    expect(sent).toEqual([]);
  });

  it('does not apply the allowlist in production', async () => {
    const { code, sent } = await run({
      appEnv: 'production',
      settings: { ...SETTINGS, EMAIL_ALLOWLIST: '' },
    });
    expect(code).toBe(0);
    expect(sent.length).toBe(WITH_EMAIL.length * 2);
  });

  it('allows a mailbox listed by exact address', async () => {
    const { code } = await run({
      settings: { ...SETTINGS, EMAIL_ALLOWLIST: 'A@Example.TEST' },
    });
    expect(code).toBe(0);
  });

  it('prints one refusal line naming the reason and sends nothing', async () => {
    const { printed, sent } = await run({
      settings: { ...SETTINGS, EMAIL_SENDING: 'off' },
    });
    expect(sent).toEqual([]);
    expect(printed).toHaveLength(1);
    expect(printed[0]).toMatch(/sending_off/);
  });

  it('refuses a whitespace-only Brevo key', async () => {
    const { code, sent } = await run({
      settings: { ...SETTINGS, BREVO_API_KEY: '   ' },
    });
    expect(code).toBe(1);
    expect(sent).toEqual([]);
  });

  it('sends each row once with the sender and reply-to', async () => {
    const { sent } = await run({
      mailboxes: ['a@example.test', 'b@example.test'],
    });
    expect(sent).toHaveLength(WITH_EMAIL.length * 2 * 2);
    for (const mail of sent) {
      expect(mail.from).toEqual({
        email: 'no-reply@mail.example.test',
        name: 'MotorFix',
      });
      expect(mail.replyTo).toEqual({
        email: 'support@mail.example.test',
        name: 'MotorFix',
      });
    }
    const keys = sent.map(
      (m) => `${JSON.stringify(m.to)}|${m.subject}|${m.html}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('carries the one-click headers on the news rows only', async () => {
    const { sent } = await run();
    const withHeaders = sent.filter((m) => m.headers);
    expect(withHeaders).toHaveLength(2);
    for (const mail of withHeaders) {
      expect(mail.headers?.['List-Unsubscribe']).toMatch(/^<https:\/\/[^>]+>$/);
      expect(mail.headers?.['List-Unsubscribe-Post']).toBe(
        'List-Unsubscribe=One-Click',
      );
    }
  });

  it('continues past a refused row, reports it and exits 1', async () => {
    let calls = 0;
    const sent: Sent[] = [];
    const { code, printed } = await run({
      send: (mail) => {
        calls += 1;
        if (calls === 3) return Promise.reject(new Error('brevo said no'));
        sent.push(mail);
        return Promise.resolve(`<id-${calls}@brevo>`);
      },
    });
    expect(code).toBe(1);
    expect(calls).toBe(WITH_EMAIL.length * 2);
    expect(sent).toHaveLength(calls - 1);
    expect(printed.filter((l) => l.includes('FAILED'))).toHaveLength(1);
    expect(printed.join('\n')).toContain('brevo said no');
    expect(printed.filter((l) => l.includes('sent <id-'))).toHaveLength(
      calls - 1,
    );
  });

  it('continues past a send that throws before returning a promise', async () => {
    let calls = 0;
    const { code, printed } = await run({
      send: () => {
        calls += 1;
        if (calls === 1) throw new Error('sync boom');
        return Promise.resolve('<ok@brevo>');
      },
    });
    expect(code).toBe(1);
    expect(calls).toBe(WITH_EMAIL.length * 2);
    expect(printed.join('\n')).toContain('sync boom');
  });

  it('reports the reason when the send rejects with a bare string', async () => {
    const { code, printed } = await run({
      registry: { GOOD: template('Hi') },
      send: () => Promise.reject('plain string failure' as unknown as Error),
    });
    expect(code).toBe(1);
    expect(printed.join('\n')).toContain('plain string failure');
  });

  it('sends none of a broken template and fails the run, sending the others', async () => {
    const broken: Template = {
      ...template('s', '{missing}'),
      example: {},
      values: {},
    };
    const { code, printed, sent } = await run({
      registry: { BROKEN: broken, GOOD: template('Hi') },
    });
    expect(code).toBe(1);
    expect(sent).toHaveLength(2);
    expect(
      printed.filter((l) => l.startsWith('BROKEN') && l.includes('FAILED')),
    ).toHaveLength(2);
  });

  it('prints each message id beside its row', async () => {
    const { printed } = await run({ registry: { GOOD: template('Hi') } });
    expect(printed).toEqual([
      'GOOD ro a@example.test Hi sent <id-1@brevo>',
      'GOOD en a@example.test Hi sent <id-2@brevo>',
    ]);
  });
});
