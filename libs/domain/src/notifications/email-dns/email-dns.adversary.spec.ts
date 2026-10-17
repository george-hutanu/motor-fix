import { checkEmailDns, type DnsResolver, dnsReport } from './email-dns';

const DOMAIN = 'mail.example.test';
const SPF = 'v=spf1 include:spf.brevo.com ~all';
const DMARC = 'v=DMARC1; p=quarantine; rua=mailto:reports@mail.example.test';

type Answer<T> = T | Error;

function code(value: string) {
  return Object.assign(new Error(value), { code: value });
}

function table(
  txt: Record<string, Answer<string[][]>>,
  cname: Record<string, Answer<string[]>>,
) {
  const asked: string[] = [];
  const resolver: DnsResolver = {
    resolveCname: (name) => {
      asked.push(`CNAME ${name}`);
      const answer = cname[name] ?? code('ENOTFOUND');
      return answer instanceof Error
        ? Promise.reject(answer)
        : Promise.resolve(answer);
    },
    resolveTxt: (name) => {
      asked.push(`TXT ${name}`);
      const answer = txt[name] ?? code('ENOTFOUND');
      return answer instanceof Error
        ? Promise.reject(answer)
        : Promise.resolve(answer);
    },
  };
  return { asked, resolver };
}

const GOOD_CNAME = {
  [`brevo1._domainkey.${DOMAIN}`]: ['b1.dkim.brevo.com'],
  [`brevo2._domainkey.${DOMAIN}`]: ['b2.dkim.brevo.com'],
};

async function state(
  txt: Record<string, Answer<string[][]>>,
  cname: Record<string, Answer<string[]>> = GOOD_CNAME,
) {
  const results = await checkEmailDns(DOMAIN, table(txt, cname).resolver);
  return {
    report: dnsReport(results),
    results,
    states: Object.fromEntries(results.map((r) => [r.record, r.state])),
  };
}

const GOOD = { [DOMAIN]: [[SPF]], [`_dmarc.${DOMAIN}`]: [[DMARC]] };

// @traces 279-FR-005
describe('the SPF record under hostile answers', () => {
  it('reads one Brevo SPF record among other TXT records as ok', async () => {
    const { states } = await state({
      ...GOOD,
      [DOMAIN]: [['google-site-verification=abc'], [SPF]],
    });
    expect(states['SPF']).toBe('ok');
  });

  it('joins an SPF record split into several strings', async () => {
    const { states } = await state({
      ...GOOD,
      [DOMAIN]: [['v=spf1 include:spf.br', 'evo.com ~all']],
    });
    expect(states['SPF']).toBe('ok');
  });

  it('reads no TXT at all as missing', async () => {
    expect((await state({ ...GOOD, [DOMAIN]: [] })).states['SPF']).toBe(
      'missing',
    );
  });

  it('reads TXT records with no SPF among them as missing', async () => {
    const { states } = await state({
      ...GOOD,
      [DOMAIN]: [['google-site-verification=abc']],
    });
    expect(states['SPF']).toBe('missing');
  });

  it('reads two SPF records as wrong', async () => {
    const { states } = await state({ ...GOOD, [DOMAIN]: [[SPF], [SPF]] });
    expect(states['SPF']).toBe('wrong');
  });

  it.each([
    ['v=spf1 include:_spf.google.com ~all'],
    ['v=spf1 include:notspf.brevo.com ~all'],
    ['v=spf1 include:spf.brevo.com.evil.test ~all'],
    ['v=spf1 -all'],
  ])('reads %s as wrong', async (record) => {
    const { states, results } = await state({ ...GOOD, [DOMAIN]: [[record]] });
    expect(states['SPF']).toBe('wrong');
    expect(results[0].reason).toBeTruthy();
  });

  it('reads a timeout as unreachable and never ok', async () => {
    const { states } = await state({ ...GOOD, [DOMAIN]: code('ETIMEOUT') });
    expect(states['SPF']).toBe('unreachable');
  });

  it('reads a failure with no code as unreachable', async () => {
    const { states } = await state({
      ...GOOD,
      [DOMAIN]: new Error('socket hang up'),
    });
    expect(states['SPF']).toBe('unreachable');
  });

  it.each([['ENOTFOUND'], ['ENODATA']])(
    'reads %s as missing',
    async (failure) => {
      const { states } = await state({ ...GOOD, [DOMAIN]: code(failure) });
      expect(states['SPF']).toBe('missing');
    },
  );
});

// @traces 279-FR-005
describe('the DKIM records under hostile answers', () => {
  it('reads both Brevo CNAMEs as ok', async () => {
    expect((await state(GOOD)).states['DKIM']).toBe('ok');
  });

  it('reads a TXT key at mail._domainkey as ok', async () => {
    const { states } = await state(
      { ...GOOD, [`mail._domainkey.${DOMAIN}`]: [['v=DKIM1; k=rsa; p=MIGf']] },
      {},
    );
    expect(states['DKIM']).toBe('ok');
  });

  it('reads a TXT key split into strings as ok', async () => {
    const { states } = await state(
      {
        ...GOOD,
        [`mail._domainkey.${DOMAIN}`]: [['v=DKIM1; k=rsa; ', 'p=MIGf']],
      },
      {},
    );
    expect(states['DKIM']).toBe('ok');
  });

  it('reads nothing at any DKIM name as missing', async () => {
    expect((await state(GOOD, {})).states['DKIM']).toBe('missing');
  });

  it('reads one of the two CNAMEs as wrong, naming the absent record', async () => {
    const { results, states } = await state(GOOD, {
      [`brevo1._domainkey.${DOMAIN}`]: ['b1.dkim.brevo.com'],
    });
    expect(states['DKIM']).toBe('wrong');
    expect(results[1].reason).toContain('brevo2');
  });

  it.each([
    ['b2.dkim.brevo.com.evil.test'],
    ['evil-dkim.brevo.com'],
    ['dkim.example.test'],
  ])(
    'reads the CNAME target %s as wrong, naming the record',
    async (target) => {
      const { results, states } = await state(GOOD, {
        ...GOOD_CNAME,
        [`brevo2._domainkey.${DOMAIN}`]: [target],
      });
      expect(states['DKIM']).toBe('wrong');
      expect(results[1].reason).toContain('brevo2');
    },
  );

  it('reads a TXT at mail._domainkey without p= as wrong', async () => {
    const { states } = await state(
      { ...GOOD, [`mail._domainkey.${DOMAIN}`]: [['v=DKIM1; k=rsa']] },
      {},
    );
    expect(states['DKIM']).toBe('wrong');
  });

  it('reads a resolver failure on a DKIM name as unreachable', async () => {
    const { states } = await state(GOOD, {
      ...GOOD_CNAME,
      [`brevo1._domainkey.${DOMAIN}`]: code('ESERVFAIL'),
    });
    expect(states['DKIM']).toBe('unreachable');
  });
});

// @traces 279-FR-005
describe('the DMARC record under hostile answers', () => {
  const at = `_dmarc.${DOMAIN}`;

  it.each([['quarantine'], ['reject']])('reads p=%s as ok', async (policy) => {
    const { states } = await state({
      ...GOOD,
      [at]: [[`v=DMARC1; p=${policy}; rua=mailto:r@mail.example.test`]],
    });
    expect(states['DMARC']).toBe('ok');
  });

  it('reads nothing at _dmarc as missing', async () => {
    expect((await state({ [DOMAIN]: [[SPF]] })).states['DMARC']).toBe(
      'missing',
    );
  });

  it('reads two DMARC records as wrong', async () => {
    const { states } = await state({ ...GOOD, [at]: [[DMARC], [DMARC]] });
    expect(states['DMARC']).toBe('wrong');
  });

  it.each([
    ['v=DMARC1; p=none'],
    ['v=DMARC1; p=bogus; rua=mailto:r@mail.example.test'],
    ['v=DMARC1; rua=mailto:r@mail.example.test'],
    ['v=DMARC1; p=quarantine; rua='],
  ])('reads %s as wrong', async (record) => {
    const { states } = await state({ ...GOOD, [at]: [[record]] });
    expect(states['DMARC']).toBe('wrong');
  });

  it('reads a TXT at _dmarc that is not DMARC as not ok', async () => {
    const { states } = await state({ ...GOOD, [at]: [['hello world']] });
    expect(states['DMARC']).not.toBe('ok');
  });

  it('reads a timeout as unreachable', async () => {
    const { states } = await state({ ...GOOD, [at]: code('ETIMEOUT') });
    expect(states['DMARC']).toBe('unreachable');
  });

  it('asks for the DMARC record at _dmarc under the domain', async () => {
    const { asked, resolver } = table(GOOD, GOOD_CNAME);
    await checkEmailDns(DOMAIN, resolver);
    expect(asked).toContain(`TXT _dmarc.${DOMAIN}`);
    expect(asked).toContain(`CNAME brevo1._domainkey.${DOMAIN}`);
    expect(asked).toContain(`CNAME brevo2._domainkey.${DOMAIN}`);
  });
});

// @traces 279-FR-006
describe('the DNS report under hostile results', () => {
  it('reports ok for all three and exits clean', async () => {
    const { report, results } = await state(GOOD);
    expect(report.ok).toBe(true);
    expect(results.map((r) => r.record)).toEqual(['SPF', 'DKIM', 'DMARC']);
    expect(report.lines.join('\n')).not.toContain('expected:');
  });

  it('names every missing record in a single run', async () => {
    const { report, states } = await state({}, {});
    expect(states).toEqual({
      DKIM: 'missing',
      DMARC: 'missing',
      SPF: 'missing',
    });
    expect(report.ok).toBe(false);
    const text = report.lines.join('\n');
    expect(text).toContain('SPF missing');
    expect(text).toContain('DKIM missing');
    expect(text).toContain('DMARC missing');
    expect(text.match(/expected:/g)).toHaveLength(3);
  });

  it('prints the expected SPF value when SPF is missing', async () => {
    const { report } = await state({ ...GOOD, [DOMAIN]: [] });
    expect(report.lines.join('\n')).toContain('spf.brevo.com');
    expect(report.ok).toBe(false);
  });

  it('notes the move to quarantine after 4 clean weeks for p=none', async () => {
    const { report, states } = await state({
      ...GOOD,
      [`_dmarc.${DOMAIN}`]: [
        ['v=DMARC1; p=none; rua=mailto:r@mail.example.test'],
      ],
    });
    expect(states['DMARC']).toBe('ok');
    expect(report.ok).toBe(true);
    const text = report.lines.join('\n');
    expect(text).toContain('quarantine');
    expect(text).toMatch(/4/);
  });

  it('adds no note for p=quarantine', async () => {
    expect((await state(GOOD)).report.lines.join('\n')).not.toMatch(
      /4 clean weeks/,
    );
  });

  it('is not ok when only one record is unreachable', async () => {
    const { report, states } = await state({
      ...GOOD,
      [DOMAIN]: code('ETIMEOUT'),
    });
    expect(states).toEqual({ DKIM: 'ok', DMARC: 'ok', SPF: 'unreachable' });
    expect(report.ok).toBe(false);
  });

  it('gives the same report when run twice', async () => {
    const first = (await state({ ...GOOD, [DOMAIN]: [] })).report;
    const second = (await state({ ...GOOD, [DOMAIN]: [] })).report;
    expect(second).toEqual(first);
  });
});
