import { type TransportItem, TransportItemType } from '@grafana/faro-web-sdk';

import { createBeforeSend, viewportClass } from './before-send';

const exception = (value: string, extra: object = {}): TransportItem =>
  ({
    meta: {
      app: { name: 'web', version: 'abc1234' },
      page: { url: 'https://motorfix.ro/ro/x?email=ana@example.com#top' },
      session: { id: 'Ab12Cd34' },
      user: { id: 'u1' },
    },
    payload: { type: 'Error', value, ...extra },
    type: TransportItemType.EXCEPTION,
  }) as TransportItem;

const measurement = (): TransportItem =>
  ({
    meta: { app: { name: 'web', version: 'abc1234' } },
    payload: { type: 'web-vitals', values: { lcp: 1 } },
    type: TransportItemType.MEASUREMENT,
  }) as TransportItem;

const text = (item: TransportItem | null) => JSON.stringify(item);

describe('viewportClass at the edges', () => {
  it.each([
    [0, 'phone'],
    [767, 'phone'],
    [768, 'tablet'],
    [1199, 'tablet'],
    [1200, 'desktop'],
    [100000, 'desktop'],
  ])('puts %i px in %s', (width, expected) => {
    expect(viewportClass(width)).toBe(expected);
  });
});

describe('beforeSend under hostile payloads', () => {
  it('drops exactly the 21st exception and keeps the first 20', () => {
    const hook = createBeforeSend('phone');
    const results = Array.from({ length: 22 }, (_, i) =>
      hook(exception(`e${i}`)),
    );

    expect(results.slice(0, 20).every((r) => r !== null)).toBe(true);
    expect(results[20]).toBeNull();
    expect(results[21]).toBeNull();
  });

  it('counts exceptions per hook instance, not globally', () => {
    const a = createBeforeSend('phone');
    for (let i = 0; i < 25; i++) a(exception('x'));

    expect(createBeforeSend('phone')(exception('x'))).not.toBeNull();
  });

  it('does not let measurements use up the exception cap', () => {
    const hook = createBeforeSend('phone');
    for (let i = 0; i < 50; i++) hook(measurement());

    expect(hook(exception('x'))).not.toBeNull();
  });

  it('masks every contact detail when many sit in one string', () => {
    const out = createBeforeSend('phone')(
      exception('a@b.ro c@d.ro 0722123456 +40 722 123 456 B 12 ABC CJ 99 XYZ'),
    );

    expect(text(out)).not.toMatch(
      /a@b\.ro|c@d\.ro|0722123456|722 123 456|B 12 ABC|CJ 99 XYZ/,
    );
  });

  it('masks inside nested objects, arrays and non-message fields', () => {
    const out = createBeforeSend('phone')(
      exception('x', {
        context: {
          deep: { who: 'ana@example.com' },
          list: ['call 0722 123 456'],
        },
        stacktrace: {
          frames: [{ filename: 'https://motorfix.ro/a.js?u=ana@example.com' }],
        },
      }),
    );

    expect(text(out)).not.toMatch(/ana@example|0722 123 456/);
  });

  it('strips query and fragment from every URL inside prose', () => {
    const out = createBeforeSend('phone')(
      exception(
        'failed https://motorfix.ro/a?token=SECRET#frag, retry http://x.io/b?q=1',
      ),
    );

    expect(text(out)).not.toMatch(/SECRET|token=|#frag|q=1/);
    expect(text(out)).toContain('https://motorfix.ro/a');
  });

  it('strips the page URL query and fragment', () => {
    const out = createBeforeSend('desktop')(exception('x'));

    expect(out?.meta.page?.url).toBe('https://motorfix.ro/ro/x');
  });

  it('removes session and user from every item type', () => {
    const hook = createBeforeSend('phone');
    for (const item of [exception('x'), measurement()]) {
      const out = hook(item);
      expect(out?.meta).not.toHaveProperty('session');
      expect(out?.meta).not.toHaveProperty('user');
    }
  });

  it('adds the viewport to measurements', () => {
    const out = createBeforeSend('tablet')(measurement());

    expect(text(out)).toContain('"viewport":"tablet"');
  });

  it('does not mutate its input', () => {
    const input = exception('ana@example.com https://a.io/x?y=1');
    const before = JSON.stringify(input);

    createBeforeSend('phone')(input);

    expect(JSON.stringify(input)).toBe(before);
  });

  it('is idempotent on its own output', () => {
    const hook = createBeforeSend('phone');
    const once = hook(exception('ana@example.com https://a.io/x?y=1'));
    const twice = createBeforeSend('phone')(once as TransportItem);

    expect(text(twice)).toBe(text(once));
  });

  it('handles an empty message and a payload with null fields', () => {
    const out = createBeforeSend('phone')(
      exception('', { context: null, stacktrace: null }),
    );

    expect(out?.payload).toMatchObject({ value: '' });
  });

  it('masks unicode-adjacent contact details', () => {
    const out = createBeforeSend('phone')(
      exception('garaj ăâî ana@example.com ș'),
    );

    expect(text(out)).not.toContain('ana@example.com');
    expect(text(out)).toContain('ăâî');
  });

  it('handles a one megabyte string', () => {
    const out = createBeforeSend('phone')(
      exception(`${'x'.repeat(1_000_000)} ana@example.com`),
    );

    expect(text(out)).not.toContain('ana@example.com');
  });
});
