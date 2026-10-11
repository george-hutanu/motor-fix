import {
  counterKeys,
  isBot,
  viewSource,
  visitorKey,
} from './profile-views.service';

const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// @traces 143-FR-004
describe('the visitor key under hostile input', () => {
  it('gives the same key twice for the same visitor', () => {
    const visitor = { address: '10.0.0.1', userAgent: CHROME };

    expect(visitorKey(visitor, 's')).toBe(visitorKey({ ...visitor }, 's'));
  });

  it('keeps a signed-in visitor on the account id whatever the secret', () => {
    const visitor = {
      accountId: 'acc-1',
      address: '10.0.0.1',
      userAgent: CHROME,
    };

    expect(visitorKey(visitor, 'monday')).toBe('acc-1');
    expect(visitorKey(visitor, 'tuesday')).toBe('acc-1');
  });

  it('makes a 64 hex key from an IPv6 address', () => {
    expect(
      visitorKey({ address: '2001:db8::1', userAgent: CHROME }, 's'),
    ).toMatch(/^[0-9a-f]{64}$/);
  });

  it('tells two IPv6 addresses of one network apart', () => {
    expect(
      visitorKey({ address: '2001:db8::1', userAgent: CHROME }, 's'),
    ).not.toBe(visitorKey({ address: '2001:db8::2', userAgent: CHROME }, 's'));
  });

  it('makes a key from an agent with accents and emoji', () => {
    expect(
      visitorKey({ address: '10.0.0.1', userAgent: 'Mozilla ț é 🚗' }, 's'),
    ).toMatch(/^[0-9a-f]{64}$/);
  });

  it('makes a key from a very long agent without holding any of it', () => {
    const key = visitorKey(
      { address: '10.0.0.1', userAgent: 'A'.repeat(1_000_000) },
      's',
    );

    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not let a newline in the agent make one visitor look like another', () => {
    expect(
      visitorKey({ address: '10.0.0.1', userAgent: 'a\nb' }, 's'),
    ).not.toBe(visitorKey({ address: '10.0.0.1', userAgent: 'a b' }, 's'));
  });

  it.each([
    ['an address with a trailing newline', '10.0.0.1\n'],
    ['an address with a port', '10.0.0.1:443'],
    ['an address with spaces', ' 10.0.0.1 '],
    ['an octet out of range', '10.0.0.256'],
    ['a name', 'localhost'],
  ])('is none for %s', (_, address) => {
    expect(visitorKey({ address, userAgent: CHROME }, 's')).toBeNull();
  });
});

// @traces 143-FR-006
describe('the bot rule under hostile input', () => {
  it.each([
    ['empty', ''],
    ['only spaces', '   '],
  ])('keeps a %s agent for the key rule', (_, agent) => {
    expect(isBot(agent)).toBe(false);
  });

  it('judges a very long agent without hanging', () => {
    expect(isBot(`${'a'.repeat(1_000_000)} Googlebot`)).toBe(true);
    expect(isBot('a'.repeat(1_000_000))).toBe(false);
  });

  it.each([
    'googlebot',
    'GOOGLEBOT/2.1',
    'Mozilla/5.0 (compatible; AhrefsBot/7.0)',
  ])('drops %s whatever its case', (agent) => {
    expect(isBot(agent)).toBe(true);
  });
});

// @traces 143-FR-007
describe('the source of a view under hostile input', () => {
  it.each([
    '__proto__',
    'constructor',
    'toString',
    'hasOwnProperty',
    'search\n',
    'search\u0000',
    'ѕearch',
    'ｓｅａｒｃｈ',
    'profile_direct '.repeat(1000),
  ])('counts %j as a direct visit', (value) => {
    expect(viewSource(value)).toBe('profile_direct');
  });

  it.each([true, false, 0, NaN, Symbol('home'), () => 'home'])(
    'counts a non-string as a direct visit',
    (value) => {
      expect(viewSource(value)).toBe('profile_direct');
    },
  );

  it('keeps the longest source name and refuses one character more', () => {
    expect(viewSource('profile_direct')).toBe('profile_direct');
    expect(viewSource('profile_directx')).toBe('profile_direct');
  });
});

// @traces 143-FR-003 143-FR-009
describe('the counters at the edges of a day', () => {
  const at = (iso: string) => counterKeys('g-1', 'home', new Date(iso));

  it('cuts the summer day at the exact Bucharest midnight', () => {
    expect(at('2026-06-14T20:59:59.999Z').total).toBe(
      'insights:pv:g-1:2026-06-14',
    );
    expect(at('2026-06-14T21:00:00.000Z').total).toBe(
      'insights:pv:g-1:2026-06-15',
    );
  });

  it('cuts the winter day at the exact Bucharest midnight', () => {
    expect(at('2026-01-14T21:59:59.999Z').total).toBe(
      'insights:pv:g-1:2026-01-14',
    );
    expect(at('2026-01-14T22:00:00.000Z').total).toBe(
      'insights:pv:g-1:2026-01-15',
    );
  });

  it('keeps the counters of 28 February in a leap year one day longer', () => {
    expect(at('2028-02-28T10:00:00Z').expiresAt).toEqual(
      new Date('2028-03-01T22:00:00Z'),
    );
    expect(at('2027-02-27T10:00:00Z').expiresAt).toEqual(
      new Date('2027-03-01T22:00:00Z'),
    );
  });

  it('expires 31 December across the new year', () => {
    expect(at('2026-12-31T09:00:00Z').expiresAt).toEqual(
      new Date('2027-01-02T22:00:00Z'),
    );
  });

  it('expires the counters of the day a clock change ends after the shortest day', () => {
    expect(at('2026-03-29T09:00:00Z').expiresAt).toEqual(
      new Date('2026-03-31T21:00:00Z'),
    );
  });

  it('gives the same names and expiry twice for the same instant', () => {
    expect(at('2026-10-10T09:00:00Z')).toEqual(at('2026-10-10T09:00:00Z'));
  });

  it('gives a source its own counter apart from the total and from the other sources', () => {
    const when = new Date('2026-10-10T09:00:00Z');
    const home = counterKeys('g-1', 'home', when);
    const saved = counterKeys('g-1', 'saved', when);

    expect(home.total).toBe(saved.total);
    expect(home.bySource).not.toBe(saved.bySource);
    expect(home.bySource).not.toBe(home.total);
  });

  it('gives two garages two counters', () => {
    const when = new Date('2026-10-10T09:00:00Z');

    expect(counterKeys('g-1', 'home', when).total).not.toBe(
      counterKeys('g-2', 'home', when).total,
    );
  });
});
