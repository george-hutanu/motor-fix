import { inboxMailboxes, inboxMatrix, runInboxTest } from './inbox-test';
import type { Brevo } from '../brevo/brevo';
import { emailConfig } from '../email-config';
import type { Registry, Template } from '../templates';
import { TEMPLATES } from '../templates/registry';

type Sent = Parameters<Brevo['send']>[0];

const WEB = 'https://staging.example.test';
const MAILBOXES = ['a@example.test', 'b@example.test'];
const SETTINGS = {
  BREVO_API_KEY: 'key',
  EMAIL_ALLOWLIST: '@example.test',
  EMAIL_DOMAIN: 'example.test',
  EMAIL_SENDING: 'on',
  PUBLIC_WEB_URL: WEB,
};
const WITH_EMAIL = Object.keys(TEMPLATES).filter((name) =>
  Boolean(TEMPLATES[name].email),
);

function run(
  options: {
    settings?: Record<string, string>;
    mailboxes?: string[];
    dryRun?: boolean;
    registry?: Registry;
    send?: (mail: Sent) => Promise<string>;
  } = {},
) {
  const sent: Sent[] = [];
  const printed: string[] = [];
  let id = 0;
  const done = runInboxTest({
    config: emailConfig('staging', options.settings ?? SETTINGS),
    dryRun: options.dryRun ?? false,
    mailboxes: options.mailboxes ?? MAILBOXES,
    print: (line) => printed.push(line),
    registry: options.registry,
    send:
      options.send ??
      ((mail) => {
        sent.push(mail);
        id += 1;
        return Promise.resolve(`<id-${id}@brevo>`);
      }),
  });
  return done.then((code) => ({ code, printed, sent }));
}

// @traces 279-email-inbox-FR-007
describe('the inbox test matrix', () => {
  it('reads the mailboxes trimmed, lower-cased and once each', () => {
    expect(
      inboxMailboxes(' A@Example.test, b@example.test ,a@example.test,, '),
    ).toEqual(['a@example.test', 'b@example.test']);
    expect(inboxMailboxes(undefined)).toEqual([]);
  });

  it('holds every e-mail template in both languages for every mailbox', () => {
    const rows = inboxMatrix(MAILBOXES, WEB);
    expect(rows).toHaveLength(WITH_EMAIL.length * 2 * MAILBOXES.length);
    for (const name of WITH_EMAIL) {
      for (const language of ['ro', 'en']) {
        for (const to of MAILBOXES) {
          expect(rows).toContainEqual(
            expect.objectContaining({ language, template: name, to }),
          );
        }
      }
    }
  });

  it('renders every example with the web app as the link base', () => {
    for (const row of inboxMatrix(['a@example.test'], WEB)) {
      expect(row.error).toBeUndefined();
      expect(row.mail?.html).not.toContain('motorfix.example');
      expect(row.mail?.text).not.toContain('motorfix.example');
    }
    const invite = inboxMatrix(['a@example.test'], WEB).find(
      (row) => row.template === 'STAFF_INVITE.mechanic',
    );
    expect(invite?.mail?.text).toContain(`${WEB}/ro/invite/example`);
  });

  // @traces 279-email-inbox-FR-008
  it('holds the launch types and no release-2 type', () => {
    const names = new Set(
      inboxMatrix(['a@example.test'], WEB).map((r) => r.template),
    );
    for (const name of [
      'SUPPORT_ACKNOWLEDGEMENT',
      'ADMIN_OUTAGE_ALERT.down',
      'ADMIN_OUTAGE_ALERT.back',
      'ACCOUNT_EMAIL.email_check',
      'ACCOUNT_EMAIL.password_reset',
      'ACCOUNT_EMAIL.password_changed',
      'LISTING_CONTINUE_LINK',
      'STAFF_INVITE.mechanic',
      'STAFF_INVITE.receptionist',
      'NEWS',
    ]) {
      expect(names).toContain(name);
    }
    for (const name of names) expect(name).not.toMatch(/PHOTO|VIDEO|LIVE/);
  });
});

// @traces 279-email-inbox-FR-009
describe('the inbox test dry run', () => {
  it('prints every row and sends nothing', async () => {
    const { code, printed, sent } = await run({ dryRun: true });
    expect(code).toBe(0);
    expect(sent).toEqual([]);
    expect(printed).toHaveLength(WITH_EMAIL.length * 2 * MAILBOXES.length);
    expect(printed).toContainEqual(
      expect.stringMatching(/^NEWS en b@example\.test \S/),
    );
  });

  it('needs neither sending, a key nor a domain', async () => {
    const { code, sent } = await run({
      dryRun: true,
      settings: { PUBLIC_WEB_URL: WEB },
    });
    expect(code).toBe(0);
    expect(sent).toEqual([]);
  });

  it('fails a row whose template does not render, and the run', async () => {
    const broken: Template = {
      audience: 'any',
      email: {
        en: {
          button: { label: 'Open', link: 'app' },
          lines: ['{missing}'],
          reason: 'r',
          subject: 's',
        },
      },
      example: {},
      values: {},
    };
    const { code, printed } = await run({
      dryRun: true,
      mailboxes: ['a@example.test'],
      registry: { BROKEN: broken },
    });
    expect(code).toBe(1);
    expect(printed).toEqual([
      expect.stringMatching(/^BROKEN ro a@example\.test FAILED /),
      expect.stringMatching(/^BROKEN en a@example\.test FAILED /),
    ]);
  });
});

// @traces 279-email-inbox-FR-010
describe('the inbox test real run', () => {
  it.each([
    [
      'sending is off',
      { ...SETTINGS, EMAIL_SENDING: 'off' },
      MAILBOXES,
      /sending_off/,
    ],
    [
      'no Brevo key',
      { ...SETTINGS, BREVO_API_KEY: '' },
      MAILBOXES,
      /BREVO_API_KEY/,
    ],
    ['no domain', { ...SETTINGS, EMAIL_DOMAIN: '' }, MAILBOXES, /EMAIL_DOMAIN/],
    ['no mailbox', SETTINGS, [], /INBOX_TEST_TO/],
    [
      'a mailbox the allowlist blocks',
      SETTINGS,
      ['a@example.test', 'c@other.test'],
      /not_allowed c@other\.test/,
    ],
  ])(
    'refuses, sending nothing, when %s',
    async (_, settings, mailboxes, reason) => {
      const { code, printed, sent } = await run({ mailboxes, settings });
      expect(code).toBe(1);
      expect(sent).toEqual([]);
      expect(printed.join('\n')).toMatch(reason);
    },
  );

  it('sends every row once, with the queue envelope', async () => {
    const { code, printed, sent } = await run();
    expect(code).toBe(0);
    expect(sent).toHaveLength(WITH_EMAIL.length * 2 * MAILBOXES.length);
    for (const mail of sent) {
      expect(mail.from).toEqual({
        email: 'no-reply@example.test',
        name: 'MotorFix',
      });
      expect(mail.replyTo).toEqual({
        email: 'support@example.test',
        name: 'MotorFix',
      });
    }
    expect(printed).toContainEqual(
      expect.stringMatching(
        /^SUPPORT_ACKNOWLEDGEMENT ro a@example\.test .* sent <id-\d+@brevo>$/,
      ),
    );
  });

  // @traces 279-email-inbox-FR-011
  it('gives the one-click headers to the news rows only', async () => {
    const { sent } = await run({ mailboxes: ['a@example.test'] });
    const withHeaders = sent.filter((mail) => mail.headers);
    expect(withHeaders).toHaveLength(2);
    for (const mail of withHeaders) {
      expect(mail.headers?.['List-Unsubscribe']).toMatch(
        new RegExp(`^<${WEB.replace(/\./g, '\\.')}/.+>$`),
      );
      expect(mail.headers?.['List-Unsubscribe-Post']).toBe(
        'List-Unsubscribe=One-Click',
      );
    }
    const news = inboxMatrix(['a@example.test'], WEB)
      .filter((row) => row.template === 'NEWS')
      .map((row) => row.mail?.subject);
    expect(withHeaders.map((mail) => mail.subject)).toEqual(news);
  });

  it('reports a refused row and still sends the rest', async () => {
    let calls = 0;
    const sent: Sent[] = [];
    const { code, printed } = await run({
      mailboxes: ['a@example.test'],
      send: (mail) => {
        calls += 1;
        if (calls === 1) return Promise.reject(new Error('provider_400'));
        sent.push(mail);
        return Promise.resolve('<ok@brevo>');
      },
    });
    expect(code).toBe(1);
    expect(sent).toHaveLength(WITH_EMAIL.length * 2 - 1);
    expect(printed[0]).toMatch(/ FAILED provider_400$/);
    expect(
      printed.slice(1).every((line) => line.endsWith(' sent <ok@brevo>')),
    ).toBe(true);
  });
});
