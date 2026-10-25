import { type TransportItem, TransportItemType } from '@grafana/faro-web-sdk';

import { createBeforeSend } from './before-send';

const on = () => true;
const off = () => false;

const meta = (extra: object = {}) => ({
  app: { name: 'web', version: 'abc1234' },
  page: { url: 'https://motorfix.ro/ro/x?email=ana@example.com#top' },
  session: { attributes: { isSampled: 'true' }, id: 'Ab12Cd34' },
  user: { email: 'ana@example.com', id: 'u1' },
  ...extra,
});

const item = (type: TransportItemType, payload: object, m = meta()) =>
  ({ meta: m, payload, type }) as unknown as TransportItem;

const journey = (name: string) =>
  item(TransportItemType.EVENT, { attributes: {}, name });

const span = (
  attributes: { key: string; value: object }[],
  resource: object = {},
) => ({
  resourceSpans: [
    {
      resource,
      scopeSpans: [{ spans: [{ attributes }, { attributes }] }],
    },
  ],
});
const sid = { key: 'session.id', value: { stringValue: 'Ab12Cd34' } };

const ALL: [string, () => TransportItem][] = [
  [
    'an error',
    () => item(TransportItemType.EXCEPTION, { type: 'E', value: 'x' }),
  ],
  [
    'a measurement',
    () =>
      item(TransportItemType.MEASUREMENT, {
        type: 'web-vitals',
        values: { lcp: 1 },
      }),
  ],
  ['a log', () => item(TransportItemType.LOG, { message: 'hi' })],
  ['an event', () => item(TransportItemType.EVENT, { name: 'click' })],
  ['a trace', () => item(TransportItemType.TRACE, span([sid]))],
];

describe('beforeSend with analytics consent', () => {
  // @traces 947-FR-008
  it.each(ALL)('strips the user from %s even with consent', (_, make) => {
    const sent = createBeforeSend('phone', on)(make());

    expect(sent).not.toBeNull();
    expect(sent?.meta).not.toHaveProperty('user');
    expect(JSON.stringify(sent)).not.toContain('u1');
    expect(JSON.stringify(sent)).not.toContain('ana@example.com');
  });

  // @traces 947-FR-001
  it.each(ALL)('leaves no session id on %s without consent', (_, make) => {
    const sent = createBeforeSend('phone', off)(make());

    expect(sent?.meta).not.toHaveProperty('session');
    expect(JSON.stringify(sent)).not.toContain('Ab12Cd34');
    expect(JSON.stringify(sent)).not.toContain('session.id');
  });

  // @traces 947-FR-009
  it('removes the session id from every span without consent', () => {
    const sent = createBeforeSend(
      'phone',
      off,
    )(
      item(
        TransportItemType.TRACE,
        span([
          sid,
          {
            key: 'http.url',
            value: { stringValue: 'https://motorfix.ro/api/x?token=1' },
          },
        ]),
      ),
    );

    expect(JSON.stringify(sent)).not.toContain('Ab12Cd34');
    expect(JSON.stringify(sent)).not.toContain('session.id');
    expect(JSON.stringify(sent)).toContain('http.url');
  });

  // @traces 947-FR-007
  it('masks personal values inside the session attributes under consent', () => {
    const sent = createBeforeSend(
      'phone',
      on,
    )(
      item(
        TransportItemType.EXCEPTION,
        { type: 'E', value: 'x' },
        meta({
          session: { attributes: { who: 'ana@example.com' }, id: 'Ab12Cd34' },
        }),
      ),
    );

    expect(JSON.stringify(sent)).not.toContain('ana@example.com');
    expect(sent?.meta.session?.id).toBe('Ab12Cd34');
  });

  // @traces 947-FR-007
  it.each(ALL)(
    'cuts the page URL to its path on %s under consent',
    (_, make) => {
      const sent = createBeforeSend('phone', on)(make());

      expect(sent?.meta.page?.url).toBe('https://motorfix.ro/ro/x');
    },
  );

  // @traces 947-FR-007
  it('masks a plate and a phone number in a journey event under consent', () => {
    const e = item(TransportItemType.EVENT, {
      attributes: { fromView: 'B 123 ABC', toView: '+40 722 123 456' },
      name: 'view_changed',
    });

    const text = JSON.stringify(createBeforeSend('phone', on)(e));

    expect(text).not.toMatch(/123 ABC|722 123 456/);
  });

  // @traces 947-FR-002
  it('does not invent a session on an item that arrived without one', () => {
    const bare = item(TransportItemType.EXCEPTION, { type: 'E', value: 'x' }, {
      app: { name: 'web', version: 'abc1234' },
    } as ReturnType<typeof meta>);

    const sent = createBeforeSend('phone', on)(bare);

    expect(sent?.meta).not.toHaveProperty('session');
  });

  // @traces 947-FR-009
  it('does not let dropped journey events use up the error cap', () => {
    const hook = createBeforeSend('phone', off);
    for (let i = 0; i < 100; i++) hook(journey('view_changed'));

    const sent = hook(
      item(TransportItemType.EXCEPTION, { type: 'E', value: 'x' }),
    );

    expect(sent).not.toBeNull();
  });

  // @traces 947-FR-009
  it('does not let journey events under consent use up the error cap', () => {
    const hook = createBeforeSend('phone', on);
    for (let i = 0; i < 100; i++) hook(journey('view_changed'));

    const results = Array.from({ length: 20 }, () =>
      hook(item(TransportItemType.EXCEPTION, { type: 'E', value: 'x' })),
    );

    expect(results.every((r) => r !== null)).toBe(true);
  });
});

describe('beforeSend and a resource-level session id', () => {
  // @traces 947-FR-009
  it('removes a session.id resource attribute from a trace without consent', () => {
    const sent = createBeforeSend(
      'phone',
      off,
    )(item(TransportItemType.TRACE, span([], { attributes: [sid] })));

    expect(JSON.stringify(sent)).not.toContain('Ab12Cd34');
  });
});

describe('beforeSend when the consent read fails', () => {
  const broken = () => {
    throw new Error('consent unavailable');
  };

  // @traces 947-FR-001
  it.each([
    'view_changed',
    'session_start',
    'session_resume',
    'session_extend',
  ])('never lets a %s event through', (name) => {
    let sent: TransportItem | null = journey(name);
    try {
      sent = createBeforeSend('phone', broken)(journey(name));
    } catch {
      sent = null;
    }

    expect(sent).toBeNull();
  });

  // @traces 947-FR-001
  it('never lets a session id through on an error', () => {
    let sent: TransportItem | null = null;
    try {
      sent = createBeforeSend(
        'phone',
        broken,
      )(item(TransportItemType.EXCEPTION, { type: 'E', value: 'x' }));
    } catch {
      sent = null;
    }

    expect(JSON.stringify(sent)).not.toContain('Ab12Cd34');
  });
});

describe('beforeSend journey names', () => {
  // @traces 947-FR-009
  it.each([
    ['name with other case', 'View_Changed'],
    ['name with padding', ' view_changed'],
  ])('treats a %s as an ordinary event', (_, name) => {
    const sent = createBeforeSend('phone', off)(journey(name));

    expect(sent).not.toBeNull();
    expect(sent?.meta).not.toHaveProperty('session');
  });

  // @traces 947-FR-001
  it('does not throw on an event whose payload has no name', () => {
    const e = item(TransportItemType.EVENT, {});

    expect(createBeforeSend('phone', off)(e)?.meta).not.toHaveProperty(
      'session',
    );
  });
});
