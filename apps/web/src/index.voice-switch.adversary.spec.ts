import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const html = readFileSync(join(__dirname, 'index.html'), 'utf8');
const source =
  /<script id="mf-voice">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

type Store = Map<string, string>;

const storage = (store: Store) => ({
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, String(value)),
});

function load(
  store: Store,
  options: { at?: number; path?: string; random?: () => number } = {},
) {
  const { at = 1_000_000, path = '/', random = () => 0.999 } = options;
  delete document.documentElement.dataset['voice'];
  new Function('localStorage', 'location', 'Date', 'Math', source)(
    storage(store),
    { pathname: path },
    { now: () => at },
    { floor: Math.floor, random },
  );
  return Number(document.documentElement.dataset['voice']);
}

const hand = (settings: unknown): number =>
  (window as unknown as { mfCopyVoice: (s: unknown) => number }).mfCopyVoice(
    settings,
  );
const mark = () => Number(document.documentElement.dataset['voice']);

afterEach(() => {
  delete document.documentElement.dataset['voice'];
});

// @traces 010-FR-010
describe('a stored copy of the settings that cannot be trusted', () => {
  const broken: [string, string][] = [
    ['pinned voice not among the enabled', '{"enabled":[3,4],"pinned":5}'],
    ['duplicate voices', '{"enabled":[3,3],"pinned":null}'],
    ['voice 0', '{"enabled":[0,3],"pinned":null}'],
    ['voice 6', '{"enabled":[3,6],"pinned":null}'],
    ['voices as strings', '{"enabled":["3","4"],"pinned":null}'],
    ['pinned as a string', '{"enabled":[3,4],"pinned":"3"}'],
    ['no voice on', '{"enabled":[],"pinned":null}'],
    ['enabled not a list', '{"enabled":3,"pinned":null}'],
    ['pinned missing', '{"enabled":[3,4]}'],
    ['fractional voice', '{"enabled":[3.5],"pinned":null}'],
    ['not JSON', 'enabled=3'],
    ['truncated JSON', '{"enabled":[3,'],
    ['JSON null', 'null'],
    ['a bare number', '3'],
    ['an empty string', ''],
  ];

  it.each(broken)('takes from all five voices with %s', (_title, raw) => {
    const store: Store = new Map([['mf-copy-voices', raw]]);

    expect(load(store)).toBe(1);
    expect((store.get('mf-copy-deck') ?? '').split(',').map(Number)).toEqual([
      2, 3, 4, 5,
    ]);
  });
});

// @traces 010-FR-010
describe('a pin stored on the device', () => {
  const pinned = JSON.stringify({ enabled: [1, 2, 3, 4, 5], pinned: 5 });

  it('is taken by a new visit on Home and leaves the stored round as it was', () => {
    const store: Store = new Map([
      ['mf-copy-voices', pinned],
      ['mf-copy', '2'],
      ['mf-copy-deck', '3,1'],
      ['mf-copy-at', '0'],
    ]);

    expect(load(store)).toBe(5);
    expect(store.get('mf-copy')).toBe('5');
    expect(store.get('mf-copy-deck')).toBe('3,1');
    expect(store.get('mf-copy-at')).toBe('1000000');
  });

  it('lets a visit keep its stored voice that is still on', () => {
    const store: Store = new Map([
      ['mf-copy-voices', pinned],
      ['mf-copy', '2'],
      ['mf-copy-deck', '3,1'],
      ['mf-copy-at', '0'],
    ]);

    expect(load(store, { path: '/ro/results/bmw' })).toBe(2);
    expect(store.get('mf-copy-deck')).toBe('3,1');
  });

  it('replaces a stored voice that is off', () => {
    const store: Store = new Map([
      ['mf-copy-voices', JSON.stringify({ enabled: [1, 5], pinned: 5 })],
      ['mf-copy', '2'],
      ['mf-copy-at', '0'],
    ]);

    expect(load(store, { path: '/ro/results/bmw' })).toBe(5);
  });
});

// @traces 010-FR-011
describe('handing the page settings it cannot use', () => {
  const garbage: [string, unknown][] = [
    ['undefined', undefined],
    ['null', null],
    ['a string', 'enabled'],
    ['a number', 3],
    ['an array', [1, 2]],
    ['an empty object', {}],
    ['no voice on', { enabled: [], pinned: null }],
    ['a pin that is off', { enabled: [1], pinned: 2 }],
    ['voice 6', { enabled: [6], pinned: null }],
    ['duplicates', { enabled: [1, 1], pinned: null }],
    ['strings', { enabled: ['1'], pinned: null }],
  ];

  it.each(garbage)(
    'keeps the voice and the stored copy when given %s',
    (_title, settings) => {
      const store: Store = new Map([
        ['mf-copy-voices', '{"enabled":[2,3],"pinned":null}'],
        ['mf-copy', '3'],
        ['mf-copy-at', '1000000'],
      ]);
      load(store, { at: 1_000_100, path: '/ro/results/bmw' });

      expect(() => hand(settings)).not.toThrow();
      expect(hand(settings)).toBe(3);
      expect(mark()).toBe(3);
      expect(store.get('mf-copy-voices')).toBe(
        '{"enabled":[2,3],"pinned":null}',
      );
    },
  );
});

// @traces 010-FR-011
describe('handing the page valid settings', () => {
  it('keeps a voice that is still on when another voice is pinned', () => {
    const store: Store = new Map([['mf-copy', '2']]);
    load(store, { path: '/ro/results/bmw' });

    expect(hand({ enabled: [1, 2, 3, 4, 5], pinned: 4 })).toBe(2);
    expect(mark()).toBe(2);
    expect(JSON.parse(store.get('mf-copy-voices') ?? 'null')).toEqual({
      enabled: [1, 2, 3, 4, 5],
      pinned: 4,
    });
  });

  it('moves a voice that is off to the pinned one, keeping the visit start', () => {
    const store: Store = new Map([
      ['mf-copy', '2'],
      ['mf-copy-at', '777'],
    ]);
    load(store, { at: 1_000_000, path: '/ro/results/bmw' });

    expect(hand({ enabled: [4, 5], pinned: 4 })).toBe(4);
    expect(mark()).toBe(4);
    expect(store.get('mf-copy')).toBe('4');
    expect(store.get('mf-copy-at')).toBe('777');
  });

  it('moves a voice that is off to an enabled voice when none is pinned', () => {
    const store: Store = new Map([['mf-copy', '2']]);
    load(store, { path: '/ro/results/bmw' });

    expect(hand({ enabled: [3], pinned: null })).toBe(3);
    expect(store.get('mf-copy')).toBe('3');
  });

  it('gives the same answer when handed the same settings twice', () => {
    load(new Map([['mf-copy', '2']]), { path: '/ro/results/bmw' });

    const first = hand({ enabled: [3, 5], pinned: null });

    expect(hand({ enabled: [3, 5], pinned: null })).toBe(first);
    expect(mark()).toBe(first);
  });
});
