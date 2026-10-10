import { loadPlausible, pageview } from './plausible';

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
