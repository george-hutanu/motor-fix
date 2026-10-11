import { isBot, viewSource, visitorKey } from './profile-views.service';

// @traces 143-FR-007
describe('the source of a view, given values a client should not send', () => {
  it.each([
    ['constructor'],
    ['__proto__'],
    ['toString'],
    ['hasOwnProperty'],
    ['Search'],
    [' search'],
    ['search '],
    ['search\n'],
    ['unknown'],
    [''],
    [0],
    [1],
    [true],
    [['search']],
    [{ source: 'search' }],
    [null],
    [undefined],
    [Symbol.iterator],
  ])('counts %p as direct', (value) => {
    expect(viewSource(value)).toBe('profile_direct');
  });

  it.each(['search', 'map', 'home', 'shared_link', 'saved', 'profile_direct'])(
    'keeps %s',
    (source) => {
      expect(viewSource(source)).toBe(source);
    },
  );
});

// @traces 143-FR-006
describe('the bot list, given awkward agents', () => {
  it.each([
    'Mozilla/5.0 (compatible; bingbot/2.0)',
    'Mozilla/5.0 (compatible; Googlebot/2.1)',
    'facebookexternalhit/1.1 link preview',
    'Mozilla/5.0 HeadlessChrome/126.0',
    'Lighthouse',
    'WGET/1.21',
    'python-requests/2.31',
    'Java/17.0.1',
  ])('names %s a bot', (agent) => {
    expect(isBot(agent)).toBe(true);
  });

  it('does not take a missing agent for a bot', () => {
    expect(isBot(undefined)).toBe(false);
  });

  it('does not take an empty agent for a bot', () => {
    expect(isBot('')).toBe(false);
  });

  it('does not take a Safari on iPhone for a bot', () => {
    expect(
      isBot(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile Safari/604.1',
      ),
    ).toBe(false);
  });
});

// @traces 143-FR-004
describe('the visitor key, given addresses that may not be read', () => {
  const secret = 'daily';

  it.each([[''], ['not an address'], ['999.1.1.1']])(
    'gives no key for the address %j',
    (address) => {
      expect(visitorKey({ address, userAgent: 'Chrome' }, secret)).toBeNull();
    },
  );

  it('gives no key for an empty agent', () => {
    expect(
      visitorKey({ address: '203.0.113.9', userAgent: '' }, secret),
    ).toBeNull();
  });

  it('gives an account id even when the address and agent are unreadable', () => {
    expect(
      visitorKey(
        { accountId: 'abc', address: '', userAgent: undefined },
        secret,
      ),
    ).toBe('abc');
  });

  it('gives one key for an IPv4 address and its IPv6-mapped form', () => {
    expect(visitorKey({ address: '203.0.113.9', userAgent: 'C' }, secret)).toBe(
      visitorKey({ address: '::ffff:203.0.113.9', userAgent: 'C' }, secret),
    );
  });

  it('gives another key under another secret', () => {
    const visitor = { address: '203.0.113.9', userAgent: 'C' };

    expect(visitorKey(visitor, 'a')).not.toBe(visitorKey(visitor, 'b'));
  });

  it('does not put the address or the agent in the key', () => {
    const key = visitorKey(
      { address: '203.0.113.9', userAgent: 'Zebra' },
      secret,
    );

    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });
});
