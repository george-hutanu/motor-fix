import { event, loadPlausible, pageview } from './plausible';

type Queued = { q?: unknown[][] };
const queue = () =>
  ((window as unknown as { plausible?: Queued }).plausible?.q ?? []).map(
    (call) => [...call],
  );
const scripts = () =>
  [...document.querySelectorAll('script')].filter((s) =>
    s.src.includes('plausible'),
  );

afterEach(() => {
  for (const script of scripts()) script.remove();
  delete (window as unknown as { plausible?: unknown }).plausible;
});

// @traces 244-FR-004
describe('the analytics script', () => {
  it("adds Plausible's manual script from its EU service once, for the domain", () => {
    loadPlausible('motorfix.ro');
    loadPlausible('motorfix.ro');

    expect(scripts()).toHaveLength(1);
    expect(scripts()[0]?.src).toBe('https://plausible.io/js/script.manual.js');
    expect(scripts()[0]?.dataset['domain']).toBe('motorfix.ro');
    expect(scripts()[0]?.defer).toBe(true);
  });

  it('queues a page view named by its route template, never by its address', () => {
    loadPlausible('motorfix.ro');

    pageview('/:lang/reset-password/:token');

    expect(queue()).toEqual([
      ['pageview', { u: `${location.origin}/:lang/reset-password/:token` }],
    ]);
  });

  it('sends nothing before the script was asked for', () => {
    pageview('/:lang');

    expect((window as unknown as { plausible?: unknown }).plausible).toBe(
      undefined,
    );
  });
});

// @traces 250-FR-003
describe('a custom event', () => {
  it('is named by the page template the page view uses, with its properties', () => {
    loadPlausible('motorfix.ro');

    event('garage_opened', '/:lang/garages/:garage', { source: 'results' });

    expect(queue()).toEqual([
      [
        'garage_opened',
        {
          props: { source: 'results' },
          u: `${location.origin}/:lang/garages/:garage`,
        },
      ],
    ]);
  });

  it('never carries the address the visitor is on', () => {
    window.history.pushState(
      {},
      '',
      '/ro/garages/service-auto-ionescu?ref=6d3b3a0e-2f8e-4b1f-8c2a-1d4e5f6a7b8c',
    );
    loadPlausible('motorfix.ro');

    event('quote_request_started', '/:lang/garages/:garage', {
      source: 'profile',
    });

    const sent = JSON.stringify(queue());
    expect(sent).not.toContain('service-auto-ionescu');
    expect(sent).not.toContain('6d3b3a0e');
    window.history.pushState({}, '', '/');
  });
});

// @traces 250-FR-010
describe('a custom event without Plausible', () => {
  it('sends nothing and does not throw before the script was asked for', () => {
    expect(() => event('listing_started', '/:lang', {})).not.toThrow();
    expect((window as unknown as { plausible?: unknown }).plausible).toBe(
      undefined,
    );
  });
});
