import { runCommand } from './commands';

const ENV = {
  APP_ENV: 'staging',
  BREVO_API_KEY: 'key',
  EMAIL_ALLOWLIST: '@example.test',
  EMAIL_DOMAIN: 'mail.example.test',
  EMAIL_SENDING: 'on',
  INBOX_TEST_TO: 'a@example.test',
  PUBLIC_WEB_URL: 'https://staging.example.test',
};

const SPF = 'v=spf1 include:spf.brevo.com ~all';
const DMARC = 'v=DMARC1; p=quarantine; rua=mailto:r@mail.example.test';

function setup(
  txt: Record<string, string[][]> = {},
  cname: Record<string, string[]> = {},
) {
  const printed: string[] = [];
  const send = jest.fn((_mail: unknown) => Promise.resolve('<id@brevo>'));
  const miss = () => Object.assign(new Error('none'), { code: 'ENOTFOUND' });
  const resolver = {
    resolveCname: jest.fn((name: string) =>
      cname[name] ? Promise.resolve(cname[name]) : Promise.reject(miss()),
    ),
    resolveTxt: jest.fn((name: string) =>
      txt[name] ? Promise.resolve(txt[name]) : Promise.reject(miss()),
    ),
  };
  return {
    print: (line: string) => printed.push(line),
    printed,
    resolver,
    send,
  };
}

const GOOD_TXT = {
  '_dmarc.mail.example.test': [[DMARC]],
  'mail.example.test': [[SPF]],
};
const GOOD_CNAME = {
  'brevo1._domainkey.mail.example.test': ['a.dkim.brevo.com'],
  'brevo2._domainkey.mail.example.test': ['b.dkim.brevo.com'],
};

// @traces 279-FR-012
describe('the worker commands under hostile input', () => {
  it.each([
    [['INBOX-TEST']],
    [['--dry-run']],
    [[' inbox-test']],
    [['email-dns']],
    [['']],
  ])('answers null for %j so the worker boots', async (argv) => {
    const d = setup();
    expect(await runCommand(argv, ENV, d)).toBeNull();
    expect(d.printed).toEqual([]);
    expect(d.send).not.toHaveBeenCalled();
  });

  it('refuses any other flag beside the dry run', async () => {
    const d = setup();
    expect(
      await runCommand(['inbox-test', '--verbose', '--dry-run'], ENV, d),
    ).toBe(1);
    expect(d.send).not.toHaveBeenCalled();
    expect(d.printed).toEqual(['unknown option: --verbose (only --dry-run)']);
  });

  it('does not read a misspelled flag as a dry run', async () => {
    const d = setup();
    const code = await runCommand(
      ['inbox-test', '--dryrun'],
      { ...ENV, EMAIL_SENDING: 'off' },
      d,
    );
    expect(code).toBe(1);
    expect(d.printed[0]).toMatch(/unknown option: --dryrun/);
    expect(d.send).not.toHaveBeenCalled();
  });
});

// @traces 279-FR-006
describe('the DNS check command under hostile input', () => {
  it.each([[undefined], [''], ['  ']])(
    'exits 1 saying the domain is not set for %j',
    async (domain) => {
      const d = setup(GOOD_TXT, GOOD_CNAME);
      const env = { ...ENV, EMAIL_DOMAIN: domain };
      expect(await runCommand(['email-dns-check'], env, d)).toBe(1);
      expect(d.printed).toEqual(['EMAIL_DOMAIN is not set']);
      expect(d.resolver.resolveTxt).not.toHaveBeenCalled();
      expect(d.resolver.resolveCname).not.toHaveBeenCalled();
    },
  );

  it.each([['https://mail.example.test'], ['nodots']])(
    'exits 1 naming %j as not a domain name',
    async (domain) => {
      const d = setup(GOOD_TXT, GOOD_CNAME);
      const env = { ...ENV, EMAIL_DOMAIN: domain };
      expect(await runCommand(['email-dns-check'], env, d)).toBe(1);
      expect(d.printed).toEqual([
        `EMAIL_DOMAIN is not a domain name: ${domain}`,
      ]);
      expect(d.resolver.resolveTxt).not.toHaveBeenCalled();
    },
  );

  it('exits 0 with every record ok through the injected resolver', async () => {
    const d = setup(GOOD_TXT, GOOD_CNAME);
    expect(await runCommand(['email-dns-check'], ENV, d)).toBe(0);
    expect(d.printed.some((l) => l.startsWith('SPF ok'))).toBe(true);
    expect(d.printed.some((l) => l.startsWith('DKIM ok'))).toBe(true);
    expect(d.printed.some((l) => l.startsWith('DMARC ok'))).toBe(true);
  });

  it('checks an upper-case domain lower-cased', async () => {
    const d = setup(GOOD_TXT, GOOD_CNAME);
    const env = { ...ENV, EMAIL_DOMAIN: ' MAIL.Example.TEST ' };
    expect(await runCommand(['email-dns-check'], env, d)).toBe(0);
  });

  it('exits 1 and prints three expected values when nothing is published', async () => {
    const d = setup();
    expect(await runCommand(['email-dns-check'], ENV, d)).toBe(1);
    expect(d.printed.filter((l) => l.includes('expected:'))).toHaveLength(3);
  });

  it('runs without any other e-mail setting and without APP_ENV', async () => {
    const d = setup(GOOD_TXT, GOOD_CNAME);
    expect(
      await runCommand(
        ['email-dns-check'],
        { EMAIL_DOMAIN: 'mail.example.test' },
        d,
      ),
    ).toBe(0);
  });
});

// @traces 279-FR-010
describe('the inbox test command under hostile input', () => {
  it('exits 1 with the message instead of throwing on a bad APP_ENV', async () => {
    const d = setup();
    const env = { ...ENV, APP_ENV: 'nonsense' };
    expect(await runCommand(['inbox-test', '--dry-run'], env, d)).toBe(1);
    expect(d.printed).toHaveLength(1);
    expect(d.printed[0]).toMatch(/APP_ENV/);
  });

  it('exits 1 with the reason for a sender off the domain', async () => {
    const d = setup();
    const env = { ...ENV, EMAIL_FROM: 'MotorFix <no-reply@other.test>' };
    expect(await runCommand(['inbox-test'], env, d)).toBe(1);
    expect(d.printed.join('\n')).toMatch(/EMAIL_FROM/);
    expect(d.send).not.toHaveBeenCalled();
  });

  it('refuses a real run with no INBOX_TEST_TO and sends nothing', async () => {
    const d = setup();
    const env = { ...ENV, INBOX_TEST_TO: undefined };
    expect(await runCommand(['inbox-test'], env, d)).toBe(1);
    expect(d.printed.join('\n')).toMatch(/INBOX_TEST_TO/);
    expect(d.send).not.toHaveBeenCalled();
  });

  it('sends once to a mailbox listed twice in other case', async () => {
    const d = setup();
    const env = { ...ENV, INBOX_TEST_TO: 'a@example.test, A@EXAMPLE.test' };
    const dry = setup();
    await runCommand(
      ['inbox-test', '--dry-run'],
      { ...env, INBOX_TEST_TO: 'a@example.test' },
      dry,
    );
    expect(await runCommand(['inbox-test'], env, d)).toBe(0);
    expect(d.send).toHaveBeenCalledTimes(dry.printed.length);
  });

  it('exits 1 and finishes the other rows when the injected send fails once', async () => {
    const d = setup();
    let calls = 0;
    d.send.mockImplementation(() => {
      calls += 1;
      return calls === 2
        ? Promise.reject(new Error('refused'))
        : Promise.resolve('<id@brevo>');
    });
    const dry = setup();
    await runCommand(['inbox-test', '--dry-run'], ENV, dry);
    expect(await runCommand(['inbox-test'], ENV, d)).toBe(1);
    expect(d.send).toHaveBeenCalledTimes(dry.printed.length);
    expect(d.printed.filter((l) => l.includes('FAILED'))).toHaveLength(1);
  });

  it('prints no secret from the environment', async () => {
    const d = setup();
    await runCommand(
      ['inbox-test'],
      { ...ENV, BREVO_API_KEY: 'sekrit-key-123' },
      d,
    );
    expect(d.printed.join('\n')).not.toContain('sekrit-key-123');
  });
});
