import { type TransportItem, TransportItemType } from '@grafana/faro-web-sdk';

import { createBeforeSend, viewportClass } from './before-send';

const meta = () => ({
  app: { name: 'web', version: 'abc1234' },
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
    const sent = createBeforeSend('phone')(
      exception('no garage for ana@example.com, 0722 123 456, B 123 ABC'),
    );

    expect(sent?.payload).toMatchObject({
      value: 'no garage for ***, ***, ***',
    });
  });

  it('masks personal values in any attribute', () => {
    const item = measurement();
    (item.payload as { context?: Record<string, string> }).context = {
      field: 'ana@example.com',
    };

    const sent = createBeforeSend('phone')(item);

    expect(JSON.stringify(sent)).not.toContain('ana@example.com');
  });

  it('sends the page URL and stack files without query or fragment', () => {
    const sent = createBeforeSend('desktop')(
      exception('fetch https://motorfix.ro/api/v1/garages?plate=x#y failed'),
    );

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

    const sent = createBeforeSend('desktop')(trace);

    expect(JSON.stringify(sent)).toContain(
      '"stringValue":"https://motorfix.ro/api/v1/garages"',
    );
    expect(JSON.stringify(sent)).not.toContain('city=Cluj');
  });

  it('sends no session and no user', () => {
    const sent = createBeforeSend('tablet')(measurement());

    expect(sent?.meta).not.toHaveProperty('session');
    expect(sent?.meta).not.toHaveProperty('user');
    expect(JSON.stringify(sent)).not.toMatch(/Ab12Cd34|user-1/);
  });

  it('keeps the view and the app version', () => {
    const sent = createBeforeSend('tablet')(measurement());

    expect(sent?.meta.view).toEqual({ name: '/:lang/garages' });
    expect(sent?.meta.app).toMatchObject({ version: 'abc1234' });
  });

  it('labels a measurement with the viewport class', () => {
    const sent = createBeforeSend('tablet')(measurement());

    expect(sent?.payload).toMatchObject({
      context: { viewport: 'tablet' },
      values: { lcp: 1200 },
    });
  });

  it('sends twenty errors per page load and drops the rest', () => {
    const beforeSend = createBeforeSend('phone');

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

    createBeforeSend('phone')(item);

    expect(item.meta.session).toBeDefined();
    expect(item.payload).toMatchObject({ value: 'ana@example.com' });
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
