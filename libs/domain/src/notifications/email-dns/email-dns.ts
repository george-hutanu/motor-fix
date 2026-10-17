// The part of node:dns/promises the check reads, so a test can answer it.
export interface DnsResolver {
  resolveTxt(name: string): Promise<string[][]>;
  resolveCname(name: string): Promise<string[]>;
}

type DnsRecord = 'SPF' | 'DKIM' | 'DMARC';

interface DnsResult {
  record: DnsRecord;
  state: 'ok' | 'missing' | 'wrong' | 'unreachable';
  found: string[];
  expected: string;
  reason?: string;
  note?: string;
}

const DKIM_NAMES = ['brevo1._domainkey', 'brevo2._domainkey'] as const;
const DKIM_HOST = 'dkim.brevo.com';

export function expectedRecords(domain: string): Record<DnsRecord, string> {
  return {
    DKIM: DKIM_NAMES.map(
      (name) =>
        `${name}.${domain} CNAME <the target Brevo shows, under ${DKIM_HOST}>`,
    ).join(' and '),
    DMARC: `_dmarc.${domain} TXT "v=DMARC1; p=none; rua=mailto:<the mailbox that reads the reports>"`,
    SPF: `${domain} TXT "v=spf1 include:spf.brevo.com ~all"`,
  };
}

class Unreachable extends Error {}

// No record at the name answers empty; any other failure is unreachable.
async function lookup<T>(ask: () => Promise<T[]>): Promise<T[]> {
  try {
    return await ask();
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ENOTFOUND' || code === 'ENODATA') return [];
    throw new Unreachable(code ?? (error as Error).message);
  }
}

// A long TXT record arrives in strings of up to 255 characters.
const txt = async (dns: DnsResolver, name: string) =>
  (await lookup(() => dns.resolveTxt(name))).map((parts) => parts.join(''));

const starting = (records: string[], prefix: string) =>
  records.filter((r) => r.toLowerCase().startsWith(prefix.toLowerCase()));

async function spf(dns: DnsResolver, domain: string) {
  const found = starting(await txt(dns, domain), 'v=spf1');
  if (found.length === 0) return { found, state: 'missing' as const };
  if (found.length > 1) {
    return {
      found,
      reason: 'more than one v=spf1 record',
      state: 'wrong' as const,
    };
  }
  return /(^|\s)include:spf\.brevo\.com(\s|$)/i.test(found[0])
    ? { found, state: 'ok' as const }
    : {
        found,
        reason: 'does not include spf.brevo.com',
        state: 'wrong' as const,
      };
}

const underBrevo = (target: string) =>
  target.toLowerCase().replace(/\.$/, '').endsWith(`.${DKIM_HOST}`);

async function dkim(dns: DnsResolver, domain: string) {
  const [first, second, key] = await Promise.all([
    ...DKIM_NAMES.map((name) =>
      lookup(() => dns.resolveCname(`${name}.${domain}`)),
    ),
    txt(dns, `mail._domainkey.${domain}`),
  ]);
  const found = [...first, ...second, ...key];
  if (found.length === 0) return { found, state: 'missing' as const };
  if (key.some((record) => /(^|;)\s*p=[^;\s]/.test(record))) {
    return { found, state: 'ok' as const };
  }
  const bad = DKIM_NAMES.filter((_, i) => ![first, second][i].some(underBrevo));
  if (bad.length === 0) return { found, state: 'ok' as const };
  const reason =
    key.length > 0 && first.length === 0 && second.length === 0
      ? `mail._domainkey holds no public key (p=)`
      : `${bad.join(' and ')} not a CNAME under ${DKIM_HOST}`;
  return { found, reason, state: 'wrong' as const };
}

async function dmarc(dns: DnsResolver, domain: string) {
  const found = starting(await txt(dns, `_dmarc.${domain}`), 'v=DMARC1');
  if (found.length === 0) return { found, state: 'missing' as const };
  if (found.length > 1) {
    return {
      found,
      reason: 'more than one v=DMARC1 record',
      state: 'wrong' as const,
    };
  }
  const tags = new Map(
    found[0].split(';').map((tag) => {
      const [key, ...value] = tag.split('=');
      return [key.trim().toLowerCase(), value.join('=').trim().toLowerCase()];
    }),
  );
  const policy = tags.get('p') ?? '';
  if (!['none', 'quarantine', 'reject'].includes(policy)) {
    return {
      found,
      reason: 'no policy (p=none, quarantine or reject)',
      state: 'wrong' as const,
    };
  }
  if (!tags.get('rua')) {
    return { found, reason: 'no rua report address', state: 'wrong' as const };
  }
  return policy === 'none'
    ? {
        found,
        note: 'p=none only reports: move to p=quarantine after 4 clean weeks of reports',
        state: 'ok' as const,
      }
    : { found, state: 'ok' as const };
}

const CHECKS = { DKIM: dkim, DMARC: dmarc, SPF: spf } as const;

export function checkEmailDns(
  domain: string,
  dns: DnsResolver,
): Promise<DnsResult[]> {
  const expected = expectedRecords(domain);
  return Promise.all(
    (['SPF', 'DKIM', 'DMARC'] as const).map(async (record) => {
      const base = { expected: expected[record], record };
      try {
        return { ...base, ...(await CHECKS[record](dns, domain)) };
      } catch (error) {
        if (!(error instanceof Unreachable)) throw error;
        const reason = error.message;
        return { ...base, found: [], reason, state: 'unreachable' as const };
      }
    }),
  );
}

export function dnsReport(results: DnsResult[]): {
  lines: string[];
  ok: boolean;
} {
  const lines: string[] = [];
  for (const result of results) {
    const detail =
      result.state === 'ok' ? result.found.join(' | ') : result.reason;
    lines.push([result.record, result.state, detail].filter(Boolean).join(' '));
    if (result.state !== 'ok') lines.push(`  expected: ${result.expected}`);
    if (result.note) lines.push(`  note: ${result.note}`);
  }
  return { lines, ok: results.every((r) => r.state === 'ok') };
}
