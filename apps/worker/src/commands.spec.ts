import { runCommand } from './commands';

const ENV = {
  APP_ENV: 'staging',
  INBOX_TEST_TO: 'a@example.test',
  PUBLIC_WEB_URL: 'https://staging.example.test',
};

function deps() {
  const printed: string[] = [];
  const send = jest.fn(() => Promise.resolve('<id@brevo>'));
  const resolver = {
    resolveCname: jest.fn(() =>
      Promise.reject(Object.assign(new Error('none'), { code: 'ENOTFOUND' })),
    ),
    resolveTxt: jest.fn(() =>
      Promise.reject(Object.assign(new Error('none'), { code: 'ENOTFOUND' })),
    ),
  };
  return {
    print: (line: string) => printed.push(line),
    printed,
    resolver,
    send,
  };
}

// @traces 279-email-inbox-FR-012
describe('the worker commands', () => {
  it('answers null for anything else, so the worker boots', async () => {
    const d = deps();
    expect(await runCommand([], ENV, d)).toBeNull();
    expect(await runCommand(['serve'], ENV, d)).toBeNull();
    expect(d.printed).toEqual([]);
  });

  it('runs the inbox test dry run without sending', async () => {
    const d = deps();
    expect(await runCommand(['inbox-test', '--dry-run'], ENV, d)).toBe(0);
    expect(d.send).not.toHaveBeenCalled();
    expect(d.printed).toContainEqual(
      expect.stringMatching(/^NEWS ro a@example\.test /),
    );
  });

  it('refuses a real inbox test while sending is off', async () => {
    const d = deps();
    expect(await runCommand(['inbox-test'], ENV, d)).toBe(1);
    expect(d.send).not.toHaveBeenCalled();
    expect(d.printed.join('\n')).toMatch(/sending_off/);
  });

  it('answers a bad setting with exit 1 and its message', async () => {
    const d = deps();
    expect(
      await runCommand(
        ['inbox-test'],
        { ...ENV, EMAIL_DOMAIN: 'not a domain', EMAIL_SENDING: 'on' },
        d,
      ),
    ).toBe(1);
    expect(d.printed.join('\n')).toMatch(/EMAIL_DOMAIN/);
  });

  // @traces 279-email-inbox-FR-006
  it('checks the domain through the resolver it is given', async () => {
    const d = deps();
    expect(
      await runCommand(
        ['email-dns-check'],
        { ...ENV, EMAIL_DOMAIN: 'example.test' },
        d,
      ),
    ).toBe(1);
    expect(d.resolver.resolveTxt).toHaveBeenCalledWith('example.test');
    expect(d.printed).toContain('SPF missing');
  });

  it('refuses the DNS check with no domain', async () => {
    const d = deps();
    expect(await runCommand(['email-dns-check'], ENV, d)).toBe(1);
    expect(d.printed).toEqual(['EMAIL_DOMAIN is not set']);
    expect(d.resolver.resolveTxt).not.toHaveBeenCalled();
  });
});
