import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const html = readFileSync(join(__dirname, 'index.html'), 'utf8');
const source =
  /<script id="mf-voice">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

type Store = Map<string, string>;

function storage(store: Store, blocked: boolean) {
  const refuse = () => {
    throw new DOMException('denied', 'SecurityError');
  };
  return {
    getItem: (key: string) => (blocked ? refuse() : (store.get(key) ?? null)),
    setItem: (key: string, value: string) =>
      blocked ? refuse() : store.set(key, String(value)),
  };
}

function load(
  store: Store,
  path: string,
  options: { at?: number; blocked?: boolean; enabled?: number[] } = {},
) {
  const { at = 1_000_000, blocked = false } = options;
  const code = options.enabled
    ? source.replace('[1, 2, 3, 4, 5]', JSON.stringify(options.enabled))
    : source;
  const root = document.documentElement;
  for (const name of ['data-voice', 'data-home', 'data-voice-new'])
    root.removeAttribute(name);
  new Function('localStorage', 'location', 'Date', 'Math', code)(
    storage(store, blocked),
    { pathname: path },
    { now: () => at },
    { floor: Math.floor, random: () => 0.5 },
  );
  return {
    home: root.hasAttribute('data-home'),
    taken: root.hasAttribute('data-voice-new'),
    voice: root.getAttribute('data-voice'),
  };
}

afterEach(() => {
  const root = document.documentElement;
  for (const name of ['data-voice', 'data-home', 'data-voice-new'])
    root.removeAttribute(name);
});

// @traces 009-FR-001
describe('the Home mark of the page head', () => {
  it.each(['/', '/ro', '/en', '/ro/', '/en/'])(
    'marks %s as Home that took a voice on a first visit',
    (path) => {
      const mark = load(new Map(), path);

      expect(mark.home).toBe(true);
      expect(mark.taken).toBe(true);
      expect(mark.voice).toMatch(/^[1-5]$/);
    },
  );

  it.each([
    '/ro/rezultate',
    '/en/results',
    '/ro/garage/some-garage',
    '/fr',
    '/rom',
    '/ro/x/',
    '/home',
    '',
  ])('marks nothing on %p, even on a first visit', (path) => {
    const mark = load(new Map(), path);

    expect(mark.home).toBe(false);
    expect(mark.taken).toBe(false);
    expect(mark.voice).toMatch(/^[1-5]$/);
  });

  it('keeps the voice and sends no take mark on a Home reload at 2499 ms', () => {
    const store: Store = new Map();
    const first = load(store, '/', { at: 1_000_000 });

    const again = load(store, '/', { at: 1_002_499 });

    expect(again).toEqual({ home: true, taken: false, voice: first.voice });
  });

  it('takes a voice again on a Home reload at exactly 2500 ms', () => {
    const store: Store = new Map();
    load(store, '/', { at: 1_000_000 });

    const again = load(store, '/', { at: 1_002_500 });

    expect(again.taken).toBe(true);
  });

  it('takes a voice when the clock went backwards', () => {
    const store: Store = new Map();
    load(store, '/', { at: 1_000_000 });

    expect(load(store, '/', { at: 999_000 }).taken).toBe(true);
  });

  it('never marks a take on another page, even after the window has passed', () => {
    const store: Store = new Map();
    const first = load(store, '/');

    const other = load(store, '/ro/rezultate', { at: 9_000_000 });

    expect(other).toEqual({ home: false, taken: false, voice: first.voice });
  });

  it('marks a take on Home with storage blocked, and not on another page', () => {
    expect(load(new Map(), '/', { blocked: true })).toEqual({
      home: true,
      taken: true,
      voice: expect.stringMatching(/^[1-5]$/),
    });
    expect(load(new Map(), '/en/results', { blocked: true })).toEqual({
      home: false,
      taken: false,
      voice: expect.stringMatching(/^[1-5]$/),
    });
  });

  it('takes the only voice that is on when the others are off', () => {
    const mark = load(new Map(), '/', { enabled: [4] });

    expect(mark).toEqual({ home: true, taken: true, voice: '4' });
  });

  it('writes the take mark with no value of its own and leaves no stale mark', () => {
    const store: Store = new Map();
    load(store, '/');
    document.documentElement.setAttribute('data-voice-new', '');

    const again = load(store, '/', { at: 1_000_100 });

    expect(again.taken).toBe(false);
  });
});
