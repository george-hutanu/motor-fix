import { createHmac } from 'node:crypto';

import {
  counterKeys,
  isBot,
  viewSource,
  visitorKey,
} from './profile-views.service';

const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// @traces 143-FR-004
describe('the visitor key', () => {
  it('is the account id when the visitor is signed in', () => {
    expect(
      visitorKey(
        { accountId: 'acc-1', address: '10.0.0.1', userAgent: CHROME },
        's',
      ),
    ).toBe('acc-1');
  });

  it('names a signed-in visitor even without an agent or a readable address', () => {
    expect(
      visitorKey(
        { accountId: 'acc-1', address: '', userAgent: undefined },
        's',
      ),
    ).toBe('acc-1');
  });

  it("is the HMAC of the client and the agent under the day's secret for a visitor", () => {
    const expected = createHmac('sha256', 'day-secret')
      .update(`10.0.0.1\n${CHROME}`)
      .digest('hex');

    expect(
      visitorKey({ address: '10.0.0.1', userAgent: CHROME }, 'day-secret'),
    ).toBe(expected);
  });

  it('reads an IPv4 address mapped into IPv6 as the same client', () => {
    expect(
      visitorKey({ address: '::ffff:10.0.0.1', userAgent: CHROME }, 's'),
    ).toBe(visitorKey({ address: '10.0.0.1', userAgent: CHROME }, 's'));
  });

  it('gives the same visitor another key under another secret', () => {
    const visitor = { address: '10.0.0.1', userAgent: CHROME };

    expect(visitorKey(visitor, 'monday')).not.toBe(
      visitorKey(visitor, 'tuesday'),
    );
  });

  it('tells two agents at one address apart', () => {
    expect(
      visitorKey({ address: '10.0.0.1', userAgent: CHROME }, 's'),
    ).not.toBe(
      visitorKey({ address: '10.0.0.1', userAgent: 'Firefox/130' }, 's'),
    );
  });

  it.each([
    ['no agent', { address: '10.0.0.1', userAgent: undefined }],
    ['an empty agent', { address: '10.0.0.1', userAgent: '' }],
    ['an unreadable address', { address: 'not-an-address', userAgent: CHROME }],
    ['no address', { address: '', userAgent: CHROME }],
  ])('is none for a visitor with %s', (_, visitor) => {
    expect(visitorKey(visitor, 's')).toBeNull();
  });

  it('never holds the address or the agent in the clear', () => {
    const key = visitorKey({ address: '10.0.0.1', userAgent: CHROME }, 's');

    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });
});

// @traces 143-FR-006
describe('the bot rule', () => {
  it.each([
    'Googlebot/2.1 (+http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0)',
    'Baiduspider',
    'Yahoo! Slurp',
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php) Fetch',
    'Mozilla/5.0 HeadlessChrome/126.0',
    'Chrome-Lighthouse',
    'curl/8.4.0',
    'Wget/1.21',
    'python-requests/2.31',
    'Java/17.0.2',
    'WhatsApp link preview',
    'SomeCrawler/1.0',
    'GOOGLEBOT',
  ])('drops %s', (agent) => {
    expect(isBot(agent)).toBe(true);
  });

  it.each([
    CHROME,
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile Safari/604.1',
    'Mozilla/5.0 (Windows NT 10.0; rv:130.0) Gecko/20100101 Firefox/130.0',
    'Mozilla/5.0 (Linux; Android 14) Chrome/126.0 Mobile Safari/537.36',
    'Mozilla/5.0 JavaScript-capable',
  ])('keeps %s', (agent) => {
    expect(isBot(agent)).toBe(false);
  });

  it('leaves a missing agent to the key rule, not the bot rule', () => {
    expect(isBot(undefined)).toBe(false);
  });
});

// @traces 143-FR-007
describe('the source of a view', () => {
  it.each(['search', 'map', 'home', 'shared_link', 'saved', 'profile_direct'])(
    'keeps %s',
    (source) => {
      expect(viewSource(source)).toBe(source);
    },
  );

  it.each([
    ['missing', undefined],
    ['null', null],
    ['a number', 3],
    ['an object', { source: 'home' }],
    ['an array', ['home']],
    ['unknown', 'newsletter'],
    ['empty', ''],
    ['in another case', 'Search'],
    ['padded', ' home '],
    ['longer than any source', 'x'.repeat(5000)],
    ['a known one with more after it', 'search_and_more'],
  ])('counts a %s source as a direct visit', (_, source) => {
    expect(viewSource(source)).toBe('profile_direct');
  });
});

// @traces 143-FR-003 143-FR-009
describe('the counters a view lands in', () => {
  const at = (iso: string) => counterKeys('g-1', 'search', new Date(iso));

  it('names the total and the source counter of the Bucharest day', () => {
    expect(at('2026-10-10T09:00:00Z')).toEqual({
      bySource: 'insights:pv:g-1:2026-10-10:search',
      expiresAt: new Date('2026-10-12T21:00:00Z'),
      total: 'insights:pv:g-1:2026-10-10',
    });
  });

  it.each([
    ['2026-06-14T20:59:00Z', '2026-06-14'],
    ['2026-06-14T21:01:00Z', '2026-06-15'],
    ['2026-01-14T21:59:00Z', '2026-01-14'],
    ['2026-01-14T22:01:00Z', '2026-01-15'],
    ['2026-03-28T21:59:00Z', '2026-03-28'],
    ['2026-03-28T22:01:00Z', '2026-03-29'],
    ['2026-03-29T20:59:00Z', '2026-03-29'],
    ['2026-03-29T21:01:00Z', '2026-03-30'],
    ['2026-10-24T20:59:00Z', '2026-10-24'],
    ['2026-10-24T21:01:00Z', '2026-10-25'],
    ['2026-10-25T21:59:00Z', '2026-10-25'],
    ['2026-10-25T22:01:00Z', '2026-10-26'],
  ])('counts a view at %s on %s', (iso, day) => {
    expect(at(iso).total).toBe(`insights:pv:g-1:${day}`);
  });

  it.each([
    ['2026-10-10T09:00:00Z', '2026-10-12T21:00:00Z'],
    ['2026-10-23T09:00:00Z', '2026-10-25T22:00:00Z'],
    ['2026-10-24T09:00:00Z', '2026-10-26T22:00:00Z'],
    ['2026-03-27T09:00:00Z', '2026-03-29T21:00:00Z'],
    ['2026-03-28T09:00:00Z', '2026-03-30T21:00:00Z'],
    ['2026-12-31T09:00:00Z', '2027-01-02T22:00:00Z'],
  ])(
    'keeps the counters of %s until the Bucharest midnight that ends two days later',
    (iso, expires) => {
      expect(at(iso).expiresAt).toEqual(new Date(expires));
    },
  );
});
