import { checkEmailDns, type DnsResolver, dnsReport } from './email-dns';

const DOMAIN = 'example.test';
const SPF = 'v=spf1 include:spf.brevo.com ~all';
const DMARC = 'v=DMARC1; p=quarantine; rua=mailto:reports@example.test';
const CNAMES = {
  'brevo1._domainkey.example.test': ['b1.example-test.dkim.brevo.com'],
  'brevo2._domainkey.example.test': ['b2.example-test.dkim.brevo.com'],
};

const fault = (code: string) => Object.assign(new Error(code), { code });

// A fixed table: a name it lacks answers as a real resolver does for a name
// with no record; an Error value is thrown as it is.
function resolver(
  txt: Record<string, string[][] | Error>,
  cname: Record<string, string[] | Error> = {},
): DnsResolver {
  const look = <T>(table: Record<string, T | Error>, name: string) => {
    const answer = table[name];
    if (answer instanceof Error) return Promise.reject(answer);
    if (answer === undefined) return Promise.reject(fault('ENOTFOUND'));
    return Promise.resolve(answer);
  };
  return {
    resolveCname: (name) => look(cname, name),
    resolveTxt: (name) => look(txt, name),
  };
}

const healthy = (
  txt: Record<string, string[][] | Error> = {},
  cname: Record<string, string[] | Error> = CNAMES,
) =>
  resolver(
    {
      [DOMAIN]: [[SPF], ['google-site-verification=abc']],
      [`_dmarc.${DOMAIN}`]: [[DMARC]],
      ...txt,
    },
    cname,
  );

const state = async (dns: DnsResolver) =>
  Object.fromEntries(
    (await checkEmailDns(DOMAIN, dns)).map((r) => [r.record, r.state]),
  ) as Record<'SPF' | 'DKIM' | 'DMARC', string>;

const result = async (dns: DnsResolver, record: string) =>
  (await checkEmailDns(DOMAIN, dns)).find((r) => r.record === record);

// @traces 279-FR-005 279-FR-006
describe('the sending domain DNS check', () => {
  it('reads all three records ok', async () => {
    const results = await checkEmailDns(DOMAIN, healthy());
    expect(results.map((r) => [r.record, r.state])).toEqual([
      ['SPF', 'ok'],
      ['DKIM', 'ok'],
      ['DMARC', 'ok'],
    ]);
    expect(dnsReport(results).ok).toBe(true);
  });

  it('names the expected value of every record from the domain', async () => {
    const { lines } = dnsReport(await checkEmailDns(DOMAIN, resolver({})));
    const [spf, dkim, dmarc] = lines.filter((l) =>
      l.startsWith('  expected: '),
    );
    expect(spf).toContain('include:spf.brevo.com');
    expect(spf).toContain(DOMAIN);
    expect(dkim).toContain(`brevo1._domainkey.${DOMAIN}`);
    expect(dkim).toContain(`brevo2._domainkey.${DOMAIN}`);
    expect(dkim).toContain('dkim.brevo.com');
    expect(dmarc).toContain(`_dmarc.${DOMAIN}`);
    expect(dmarc).toContain('v=DMARC1');
    expect(dmarc).toContain('rua=');
  });

  describe('SPF', () => {
    it('is missing with no v=spf1 record', async () => {
      expect((await state(healthy({ [DOMAIN]: [['other=1']] }))).SPF).toBe(
        'missing',
      );
      expect((await state(healthy({ [DOMAIN]: fault('ENODATA') }))).SPF).toBe(
        'missing',
      );
    });

    it('is wrong with two records, naming why', async () => {
      const spf = await result(healthy({ [DOMAIN]: [[SPF], [SPF]] }), 'SPF');
      expect(spf?.state).toBe('wrong');
      expect(spf?.reason).toMatch(/two|more than one/i);
    });

    it('is wrong without the Brevo include', async () => {
      const spf = await result(
        healthy({ [DOMAIN]: [['v=spf1 include:_spf.google.com ~all']] }),
        'SPF',
      );
      expect(spf?.state).toBe('wrong');
      expect(spf?.reason).toContain('spf.brevo.com');
    });

    it('joins a record split into strings before reading it', async () => {
      expect(
        (
          await state(
            healthy({
              [DOMAIN]: [['v=spf1 include:spf.', 'brevo.com ~all']],
            }),
          )
        ).SPF,
      ).toBe('ok');
    });
  });

  describe('DKIM', () => {
    it('is ok with a legacy key record holding p=', async () => {
      expect(
        (
          await state(
            healthy(
              { [`mail._domainkey.${DOMAIN}`]: [['k=rsa; p=MIGfMA0']] },
              {},
            ),
          )
        ).DKIM,
      ).toBe('ok');
    });

    it('is missing with nothing at any of its names', async () => {
      expect((await state(healthy({}, {}))).DKIM).toBe('missing');
    });

    it('is wrong with one record of the two', async () => {
      const dkim = await result(
        healthy(
          {},
          {
            'brevo1._domainkey.example.test':
              CNAMES['brevo1._domainkey.example.test'],
          },
        ),
        'DKIM',
      );
      expect(dkim?.state).toBe('wrong');
      expect(dkim?.reason).toContain('brevo2._domainkey');
    });

    it('is wrong with a target outside dkim.brevo.com', async () => {
      const dkim = await result(
        healthy(
          {},
          {
            ...CNAMES,
            'brevo2._domainkey.example.test': ['b2.dkim.brevo.com.evil.test'],
          },
        ),
        'DKIM',
      );
      expect(dkim?.state).toBe('wrong');
      expect(dkim?.reason).toContain('brevo2._domainkey');
    });

    it('is wrong with a key record without p=', async () => {
      const dkim = await result(
        healthy({ [`mail._domainkey.${DOMAIN}`]: [['k=rsa']] }, {}),
        'DKIM',
      );
      expect(dkim?.state).toBe('wrong');
      expect(dkim?.reason).toContain('mail._domainkey');
    });
  });

  describe('DMARC', () => {
    it('is missing without a record', async () => {
      expect(
        (await state(healthy({ [`_dmarc.${DOMAIN}`]: fault('ENOTFOUND') })))
          .DMARC,
      ).toBe('missing');
    });

    it('is wrong without a policy', async () => {
      const dmarc = await result(
        healthy({
          [`_dmarc.${DOMAIN}`]: [['v=DMARC1; rua=mailto:r@example.test']],
        }),
        'DMARC',
      );
      expect(dmarc?.state).toBe('wrong');
      expect(dmarc?.reason).toMatch(/policy/);
    });

    it('is wrong without a report address', async () => {
      const dmarc = await result(
        healthy({ [`_dmarc.${DOMAIN}`]: [['v=DMARC1; p=none']] }),
        'DMARC',
      );
      expect(dmarc?.state).toBe('wrong');
      expect(dmarc?.reason).toContain('rua');
    });

    it('is ok at p=none, with the move to quarantine noted', async () => {
      const dmarc = await result(
        healthy({
          [`_dmarc.${DOMAIN}`]: [
            ['v=DMARC1; p=none; rua=mailto:r@example.test'],
          ],
        }),
        'DMARC',
      );
      expect(dmarc?.state).toBe('ok');
      expect(dmarc?.note).toMatch(/quarantine.*4 clean weeks/);
    });
  });

  it('reads a resolver failure as unreachable, never ok or missing', async () => {
    const dns = healthy({
      [DOMAIN]: fault('ETIMEOUT'),
      [`_dmarc.${DOMAIN}`]: fault('ESERVFAIL'),
    });
    expect(await state(dns)).toEqual({
      DKIM: 'ok',
      DMARC: 'unreachable',
      SPF: 'unreachable',
    });
    expect(
      (
        await state(
          healthy(
            {},
            { ...CNAMES, 'brevo1._domainkey.example.test': fault('ETIMEOUT') },
          ),
        )
      ).DKIM,
    ).toBe('unreachable');
  });

  it('reports each record, the expected value of each not ok, and fails', async () => {
    const results = await checkEmailDns(
      DOMAIN,
      healthy({
        [DOMAIN]: [['other=1']],
        [`_dmarc.${DOMAIN}`]: [['v=DMARC1; p=none; rua=mailto:r@example.test']],
      }),
    );
    const report = dnsReport(results);
    expect(report.ok).toBe(false);
    expect(report.lines).toEqual([
      'SPF missing',
      expect.stringMatching(/^ {2}expected: .*v=spf1 include:spf\.brevo\.com/),
      expect.stringMatching(/^DKIM ok/),
      expect.stringMatching(/^DMARC ok v=DMARC1; p=none/),
      expect.stringMatching(/^ {2}note: .*quarantine/),
    ]);
  });
});
