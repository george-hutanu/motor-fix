import { type TransportItem, TransportItemType } from '@grafana/faro-web-sdk';

import { createBeforeSend, viewportClass } from './before-send';

// No analytics consent: the state ST-877 built for.
const off = () => false;

const meta = () => ({
  app: { name: 'web', version: 'abc1234' },
  browser: {
    brands: [{ brand: 'Chromium', version: '141' }],
    mobile: false,
    name: 'Chrome',
    os: 'Android 15',
    userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/141.0',
    version: '141.0',
  },
  page: { url: 'https://motorfix.ro/ro/garages?email=ana@example.com#top' },
  session: { attributes: { isSampled: 'true' }, id: 'Ab12Cd34' },
  user: { email: 'ana@example.com', id: 'user-1' },
  view: { name: '/:lang/garages' },
});

const exception = (value: string): TransportItem =>
  ({
    meta: meta(),
    payload: {
      stacktrace: {
        frames: [
          {
            colno: 12,
            filename: 'https://motorfix.ro/chunk-AB12.js?v=2#x',
            function: 'send',
            lineno: 1,
          },
        ],
      },
      timestamp: '2026-10-08T10:00:00.000Z',
      type: 'Error',
      value,
    },
    type: TransportItemType.EXCEPTION,
  }) as TransportItem;

const measurement = (): TransportItem =>
  ({
    meta: meta(),
    payload: {
      timestamp: '2026-10-08T10:00:00.000Z',
      type: 'web-vitals',
      values: { lcp: 1200 },
    },
    type: TransportItemType.MEASUREMENT,
  }) as TransportItem;

describe('beforeSend', () => {
  it('masks e-mails, Romanian phones and plates in the message', () => {
    const sent = createBeforeSend(
      'phone',
      off,
    )(exception('no garage for ana@example.com, 0722 123 456, B 123 ABC'));

    expect(sent?.payload).toMatchObject({
      value: 'no garage for ***, ***, ***',
    });
  });

  it('masks personal values in any attribute', () => {
    const item = measurement();
    (item.payload as { context?: Record<string, string> }).context = {
      field: 'ana@example.com',
    };

    const sent = createBeforeSend('phone', off)(item);

    expect(JSON.stringify(sent)).not.toContain('ana@example.com');
  });

  it('sends the page URL and stack files without query or fragment', () => {
    const sent = createBeforeSend(
      'desktop',
      off,
    )(exception('fetch https://motorfix.ro/api/v1/garages?plate=x#y failed'));

    expect(sent?.meta.page?.url).toBe('https://motorfix.ro/ro/garages');
    expect(sent?.payload).toMatchObject({
      stacktrace: {
        frames: [{ filename: 'https://motorfix.ro/chunk-AB12.js' }],
      },
      value: 'fetch https://motorfix.ro/api/v1/garages failed',
    });
  });

  it('strips the query of a URL in a trace span', () => {
    const trace = {
      meta: meta(),
      payload: {
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: [
                  {
                    attributes: [
                      {
                        key: 'http.url',
                        value: {
                          stringValue:
                            'https://motorfix.ro/api/v1/garages?city=Cluj',
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      type: TransportItemType.TRACE,
    } as unknown as TransportItem;

    const sent = createBeforeSend('desktop', off)(trace);

    expect(JSON.stringify(sent)).toContain(
      '"stringValue":"https://motorfix.ro/api/v1/garages"',
    );
    expect(JSON.stringify(sent)).not.toContain('city=Cluj');
  });

  it('sends no session and no user', () => {
    const sent = createBeforeSend('tablet', off)(measurement());

    expect(sent?.meta).not.toHaveProperty('session');
    expect(sent?.meta).not.toHaveProperty('user');
    expect(JSON.stringify(sent)).not.toMatch(/Ab12Cd34|user-1/);
  });

  // @traces 243-FR-015
  it('sends no browser description, only its name, version and system', () => {
    const sent = createBeforeSend('phone', off)(exception('boom'));

    expect(sent?.meta.browser).toEqual({
      mobile: false,
      name: 'Chrome',
      os: 'Android 15',
      version: '141.0',
    });
    expect(JSON.stringify(sent)).not.toMatch(/Mozilla|Pixel 9|Chromium/);
  });

  it('keeps the view and the app version', () => {
    const sent = createBeforeSend('tablet', off)(measurement());

    expect(sent?.meta.view).toEqual({ name: '/:lang/garages' });
    expect(sent?.meta.app).toMatchObject({ version: 'abc1234' });
  });

  it('labels a measurement with the viewport class', () => {
    const sent = createBeforeSend('tablet', off)(measurement());

    expect(sent?.payload).toMatchObject({
      context: { viewport: 'tablet' },
      values: { lcp: 1200 },
    });
  });

  it('sends twenty errors per page load and drops the rest', () => {
    const beforeSend = createBeforeSend('phone', off);

    const sent = Array.from({ length: 25 }, (_, n) =>
      beforeSend(exception(`error ${n}`)),
    );

    expect(sent.filter(Boolean)).toHaveLength(20);
    expect(sent[19]).not.toBeNull();
    expect(sent[20]).toBeNull();
    expect(beforeSend(measurement())).not.toBeNull();
  });

  it('leaves the item it was given unchanged', () => {
    const item = exception('ana@example.com');

    createBeforeSend('phone', off)(item);

    expect(item.meta.session).toBeDefined();
    expect(item.payload).toMatchObject({ value: 'ana@example.com' });
  });
});

const event = (name: string, attributes: Record<string, string> = {}) =>
  ({
    meta: meta(),
    payload: { attributes, domain: 'browser', name },
    type: TransportItemType.EVENT,
  }) as unknown as TransportItem;

const tracedSession = () =>
  ({
    meta: meta(),
    payload: {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  attributes: [
                    { key: 'session.id', value: { stringValue: 'Ab12Cd34' } },
                    { key: 'http.method', value: { stringValue: 'GET' } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    type: TransportItemType.TRACE,
  }) as unknown as TransportItem;

const JOURNEY = [
  'view_changed',
  'session_start',
  'session_resume',
  'session_extend',
];

describe('beforeSend and the analytics consent', () => {
  // @traces 947-FR-001
  // @traces 947-FR-009
  it.each(JOURNEY)('drops a %s event without consent', (name) => {
    expect(createBeforeSend('phone', off)(event(name))).toBeNull();
  });

  // @traces 947-FR-009
  it('keeps any other event without consent, its session stripped', () => {
    const sent = createBeforeSend('phone', off)(event('click'));

    expect(sent).not.toBeNull();
    expect(sent?.meta).not.toHaveProperty('session');
  });

  // @traces 947-FR-003
  // @traces 947-FR-009
  it('removes the session id from a trace span without consent', () => {
    const sent = createBeforeSend('desktop', off)(tracedSession());

    expect(JSON.stringify(sent)).not.toContain('session.id');
    expect(JSON.stringify(sent)).not.toContain('Ab12Cd34');
    expect(JSON.stringify(sent)).toContain('http.method');
  });

  // @traces 947-FR-002
  it.each(JOURNEY)(
    'sends a %s event with its session under consent',
    (name) => {
      const sent = createBeforeSend('phone', () => true)(event(name));

      expect(sent?.meta.session).toEqual({
        attributes: { isSampled: 'true' },
        id: 'Ab12Cd34',
      });
    },
  );

  // @traces 947-FR-002
  it('keeps the session on errors and traces under consent, never the user', () => {
    const beforeSend = createBeforeSend('phone', () => true);

    const error = beforeSend(exception('boom'));
    const trace = beforeSend(tracedSession());

    expect(error?.meta.session?.id).toBe('Ab12Cd34');
    expect(error?.meta).not.toHaveProperty('user');
    expect(JSON.stringify(trace)).toContain('session.id');
    expect(JSON.stringify([error, trace])).not.toContain('user-1');
  });

  // @traces 947-FR-009
  it('reads the consent anew for every item', () => {
    let on = true;
    const beforeSend = createBeforeSend('phone', () => on);

    expect(beforeSend(event('view_changed'))).not.toBeNull();
    on = false;
    expect(beforeSend(event('view_changed'))).toBeNull();
    expect(beforeSend(measurement())?.meta).not.toHaveProperty('session');
    on = true;
    expect(beforeSend(measurement())?.meta.session?.id).toBe('Ab12Cd34');
  });

  // @traces 947-FR-007
  it('masks personal values and URL tails in a journey event', () => {
    const sent = createBeforeSend(
      'phone',
      () => true,
    )(
      event('view_changed', {
        fromView: 'https://motorfix.ro/ro/x?plate=B123ABC',
        toView: 'ana@example.com 0722 123 456 B 123 ABC',
      }),
    );

    expect(sent?.payload).toMatchObject({
      attributes: {
        fromView: 'https://motorfix.ro/ro/x',
        toView: '*** *** ***',
      },
    });
  });
});

describe('viewportClass', () => {
  it.each([
    [320, 'phone'],
    [767, 'phone'],
    [768, 'tablet'],
    [1199, 'tablet'],
    [1200, 'desktop'],
    [1920, 'desktop'],
  ])('classes a %i px wide viewport as %s', (width, expected) => {
    expect(viewportClass(width)).toBe(expected);
  });
});
