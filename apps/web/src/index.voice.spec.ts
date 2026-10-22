import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The script that picks the visit's voice runs in the page head, before the
// app; it is read from the shipped page and run here against a fake storage.
const html = readFileSync(join(__dirname, 'index.html'), 'utf8');
const source =
  /<script id="mf-voice">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

type Store = Map<string, string>;

function storage(store: Store, blocked = false) {
  const refuse = () => {
    throw new DOMException('denied', 'SecurityError');
  };
  return {
    getItem: (key: string) => (blocked ? refuse() : (store.get(key) ?? null)),
    setItem: (key: string, value: string) =>
      blocked ? refuse() : store.set(key, String(value)),
  };
}

interface Load {
  at?: number;
  blocked?: boolean;
  enabled?: number[];
  path?: string;
  random?: () => number;
}

// One full page load: the script runs, and the page's mark is returned.
function load(store: Store, options: Load = {}) {
  const {
    at = 1_000_000,
    blocked = false,
    path = '/',
    random = () => 0.999,
  } = options;
  const code = options.enabled
    ? source.replace('[1, 2, 3, 4, 5]', JSON.stringify(options.enabled))
    : source;
  delete document.documentElement.dataset['voice'];
  new Function('localStorage', 'location', 'Date', 'Math', code)(
    storage(store, blocked),
    { pathname: path },
    { now: () => at },
    { floor: Math.floor, random },
  );
  return Number(document.documentElement.dataset['voice']);
}

const round = (store: Store) => store.get('mf-copy-deck');

afterEach(() => {
  delete document.documentElement.dataset['voice'];
});

it('is in the page head, before anything is painted', () => {
  expect(source).not.toBe('');
  expect(html.indexOf('id="mf-voice"')).toBeLessThan(html.indexOf('<body'));
});

// @traces 006-FR-002
describe('a first visit to Home', () => {
  it('starts a shuffled round of the five voices and stores what is left of it', () => {
    const store: Store = new Map();
    const voice = load(store);

    expect([1, 2, 3, 4, 5]).toContain(voice);
    expect(store.get('mf-copy')).toBe(String(voice));
    expect(store.get('mf-copy-at')).toBe('1000000');
    const rest = (round(store) ?? '').split(',').map(Number);
    expect([voice, ...rest].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('shuffles: another draw gives another order', () => {
    const first: Store = new Map();
    const second: Store = new Map();
    load(first, { random: () => 0.999 });
    load(second, { random: () => 0 });

    expect(`${first.get('mf-copy')},${round(first)}`).not.toBe(
      `${second.get('mf-copy')},${round(second)}`,
    );
  });
});

// @traces 006-FR-002
it('walks the stored round one voice per Home load', () => {
  const store: Store = new Map([['mf-copy-deck', '3,1,5,2,4']]);
  const seen = [0, 1, 2, 3, 4].map((i) =>
    load(store, { at: 1_000_000 + i * 3000 }),
  );

  expect(seen).toEqual([3, 1, 5, 2, 4]);
  expect(round(store)).toBe('');
});

// @traces 006-FR-003
describe('the seam between two rounds', () => {
  it('moves the last voice of the old round to the end of the new one', () => {
    // Math.random() near 1 leaves the shuffle in order: 1,2,3,4,5.
    const store: Store = new Map([
      ['mf-copy', '1'],
      ['mf-copy-deck', ''],
      ['mf-copy-at', '0'],
    ]);

    expect(load(store)).toBe(2);
    expect(round(store)).toBe('3,4,5,1');
  });

  it('keeps the new round as drawn when it does not start with the last voice', () => {
    const store: Store = new Map([
      ['mf-copy', '3'],
      ['mf-copy-deck', ''],
      ['mf-copy-at', '0'],
    ]);

    expect(load(store)).toBe(1);
    expect(round(store)).toBe('2,3,4,5');
  });
});

// @traces 006-FR-004
describe('two Home loads close together', () => {
  const stored = (at: number): Store =>
    new Map([
      ['mf-copy', '3'],
      ['mf-copy-deck', '1,5'],
      ['mf-copy-at', String(at)],
    ]);

  it('keeps the voice when the second comes under 2.5 seconds later', () => {
    const store = stored(1_000_000);

    expect(load(store, { at: 1_002_499 })).toBe(3);
    expect(round(store)).toBe('1,5');
  });

  it('advances at 2.5 seconds exactly', () => {
    expect(load(stored(1_000_000), { at: 1_002_500 })).toBe(1);
  });

  it('advances when the stored time is in the future', () => {
    expect(load(stored(1_000_000), { at: 999_000 })).toBe(1);
  });

  it('advances when no time was stored', () => {
    const store = stored(0);
    store.delete('mf-copy-at');

    expect(load(store)).toBe(1);
  });
});

// @traces 006-FR-005
describe('which pages advance', () => {
  const stored = (): Store =>
    new Map([
      ['mf-copy', '3'],
      ['mf-copy-deck', '1,5'],
      ['mf-copy-at', '0'],
    ]);

  it.each(['/', '/ro', '/en', '/ro/', '/en/'])(
    'advances on Home at %s',
    (path) => {
      expect(load(stored(), { path })).toBe(1);
    },
  );

  it.each(['/ro/results/bmw', '/en/garages/dobre', '/ro/cockpit', '/robots'])(
    'keeps the stored voice at %s',
    (path) => {
      const store = stored();

      expect(load(store, { path })).toBe(3);
      expect(round(store)).toBe('1,5');
    },
  );

  it('starts a round on another page when none was stored', () => {
    const store: Store = new Map();
    const voice = load(store, { path: '/ro/results/bmw' });

    expect([1, 2, 3, 4, 5]).toContain(voice);
    expect(store.get('mf-copy')).toBe(String(voice));
  });
});

// @traces 006-FR-011
describe('voices that are switched off or stored wrong', () => {
  it('skips a voice that is off, in the round and as the stored voice', () => {
    const store: Store = new Map([
      ['mf-copy', '2'],
      ['mf-copy-deck', '2,4,1'],
      ['mf-copy-at', '0'],
    ]);

    expect(load(store, { enabled: [1, 3, 4, 5] })).toBe(4);
    expect(round(store)).toBe('1');
  });

  it('starts a new round of the voices that are on', () => {
    const store: Store = new Map();
    const voice = load(store, { enabled: [2, 4] });
    const rest = (round(store) ?? '').split(',').map(Number);

    expect([voice, ...rest].sort()).toEqual([2, 4]);
  });

  it('repeats the one voice that is on', () => {
    const store: Store = new Map();

    expect(load(store, { enabled: [3] })).toBe(3);
    expect(load(store, { at: 2_000_000, enabled: [3] })).toBe(3);
  });

  it('on another page, starts over when the stored voice is off', () => {
    const store: Store = new Map([['mf-copy', '2']]);

    expect(load(store, { enabled: [1, 3], path: '/ro/results/bmw' })).not.toBe(
      2,
    );
  });

  it('drops what is not a voice and voices told twice from the stored round', () => {
    const store: Store = new Map([
      ['mf-copy-deck', 'x,9,0,4,4,,2'],
      ['mf-copy-at', '0'],
    ]);

    expect(load(store)).toBe(4);
    expect(round(store)).toBe('2');
  });

  it('starts over when the stored voice is no voice', () => {
    const store: Store = new Map([
      ['mf-copy', 'banana'],
      ['mf-copy-deck', ''],
    ]);

    expect(load(store, { path: '/ro/results/bmw' })).toBe(1);
  });
});

// @traces 006-FR-009
describe('a browser that refuses to store', () => {
  it('shows a random voice and stores nothing', () => {
    const store: Store = new Map();

    expect(load(store, { blocked: true, random: () => 0.5 })).toBe(3);
    expect(store.size).toBe(0);
  });

  it('draws among the voices that are on', () => {
    expect(
      load(new Map(), { blocked: true, enabled: [2, 5], random: () => 0.9 }),
    ).toBe(5);
  });
});

type Settings = { enabled: number[]; pinned: number | null };

const kept = (store: Store, settings: unknown) =>
  store.set('mf-copy-voices', JSON.stringify(settings));

const hand = (settings: unknown): number =>
  (window as unknown as { mfCopyVoice: (s: unknown) => number }).mfCopyVoice(
    settings,
  );

const mark = () => Number(document.documentElement.dataset['voice']);

// @traces 010-FR-010
describe("the device's copy of the voice settings", () => {
  it('draws a new round from the voices that are on', () => {
    const store: Store = new Map();
    kept(store, { enabled: [2, 4], pinned: null });

    const voice = load(store);
    const rest = (round(store) ?? '').split(',').map(Number);

    expect([voice, ...rest].sort()).toEqual([2, 4]);
  });

  it('skips a voice switched off in the stored round and as the stored voice', () => {
    const store: Store = new Map([
      ['mf-copy', '3'],
      ['mf-copy-deck', '3,4,1'],
    ]);
    kept(store, { enabled: [1, 2, 4, 5], pinned: null });

    expect(load(store, { at: 999_000, path: '/ro/results/bmw' })).toBe(4);
  });

  it('gives a new visit the pinned voice, stored with the time, the round left as it was', () => {
    const store: Store = new Map([
      ['mf-copy', '1'],
      ['mf-copy-deck', '2,3'],
    ]);
    kept(store, { enabled: [1, 2, 3, 4, 5], pinned: 4 });

    expect(load(store, { at: 9_000_000 })).toBe(4);
    expect(store.get('mf-copy')).toBe('4');
    expect(store.get('mf-copy-at')).toBe('9000000');
    expect(round(store)).toBe('2,3');
  });

  it('keeps a stored voice that is still on, even with another voice pinned', () => {
    const store: Store = new Map([
      ['mf-copy', '2'],
      ['mf-copy-at', '1000000'],
    ]);
    kept(store, { enabled: [1, 2, 3], pinned: 3 });

    expect(load(store, { at: 1_000_100 })).toBe(2);
    expect(load(store, { path: '/ro/results/bmw' })).toBe(2);
  });

  it.each([
    'banana',
    { enabled: [], pinned: null },
    { enabled: [1, 9], pinned: null },
    { enabled: [2, 2], pinned: null },
    { enabled: [1, 2], pinned: 5 },
    { enabled: '1,2', pinned: null },
  ])(
    'counts the stored settings %j as all five on, none pinned',
    (settings) => {
      const store: Store = new Map();
      kept(store, settings);
      const voice = load(store);
      const rest = (round(store) ?? '').split(',').map(Number);

      expect([voice, ...rest].sort()).toEqual([1, 2, 3, 4, 5]);
    },
  );
});

// @traces 010-FR-011
describe('the settings the app hands over', () => {
  it('keeps them on the device for the next loads', () => {
    const store: Store = new Map();
    load(store);
    const settings: Settings = { enabled: [1, 3], pinned: null };

    hand(settings);

    expect(JSON.parse(store.get('mf-copy-voices') ?? 'null')).toEqual(settings);
  });

  it('moves a visit whose voice is now off to the next voice on, keeping its start time', () => {
    const store: Store = new Map();
    const voice = load(store, { at: 5_000_000 });
    const enabled = [1, 2, 3, 4, 5].filter((v) => v !== voice);

    const moved = hand({ enabled, pinned: null });

    expect(enabled).toContain(moved);
    expect(mark()).toBe(moved);
    expect(store.get('mf-copy')).toBe(String(moved));
    expect(store.get('mf-copy-at')).toBe('5000000');
  });

  it('moves it to the pinned voice when one is pinned', () => {
    const store: Store = new Map();
    const voice = load(store);
    const pinned = voice === 5 ? 4 : 5;

    expect(hand({ enabled: [pinned], pinned })).toBe(pinned);
    expect(mark()).toBe(pinned);
  });

  it('leaves a voice that is still on, even when another is pinned', () => {
    const store: Store = new Map();
    const voice = load(store);
    const pinned = voice === 5 ? 4 : 5;

    expect(hand({ enabled: [1, 2, 3, 4, 5], pinned })).toBe(voice);
    expect(mark()).toBe(voice);
  });

  it('ignores settings that are not settings', () => {
    const store: Store = new Map();
    const voice = load(store);

    expect(hand({ enabled: [], pinned: null })).toBe(voice);
    expect(store.has('mf-copy-voices')).toBe(false);
  });

  it('still moves the voice when the browser refuses to store', () => {
    const voice = load(new Map(), { blocked: true, random: () => 0 });

    const moved = hand({ enabled: [voice === 1 ? 2 : 1], pinned: null });

    expect(moved).not.toBe(voice);
    expect(mark()).toBe(moved);
  });
});
