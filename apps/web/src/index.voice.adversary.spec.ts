import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const html = readFileSync(join(__dirname, 'index.html'), 'utf8');
const source =
  /<script id="mf-voice">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

type Store = Map<string, string>;

interface FakeStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

const plain = (store: Store): FakeStorage => ({
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => {
    store.set(key, String(value));
  },
});

interface Load {
  at?: number;
  enabled?: number[];
  path?: string;
  random?: () => number;
  storage?: FakeStorage | null;
}

function load(store: Store, options: Load = {}) {
  const { at = 1_000_000, path = '/', random = () => 0.999 } = options;
  const code = options.enabled
    ? source.replace('[1, 2, 3, 4, 5]', JSON.stringify(options.enabled))
    : source;
  delete document.documentElement.dataset['voice'];
  new Function('localStorage', 'location', 'Date', 'Math', code)(
    options.storage === undefined ? plain(store) : options.storage,
    { pathname: path },
    { now: () => at },
    { floor: Math.floor, random },
  );
  return document.documentElement.dataset['voice'];
}

// A seeded generator, so a failing walk can be replayed.
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

// Walks many Home loads 3 s apart and cuts the shown voices into rounds: a
// round ends on the load that leaves the stored round empty.
function walk(loads: number, seed: number, enabled?: number[]) {
  const store: Store = new Map();
  const random = seeded(seed);
  const shown: number[] = [];
  const rounds: number[][] = [];
  let current: number[] = [];
  for (let i = 0; i < loads; i++) {
    const voice = Number(
      load(store, { at: 10_000_000 + i * 3000, enabled, random }),
    );
    shown.push(voice);
    current.push(voice);
    if ((store.get('mf-copy-deck') ?? '') === '') {
      rounds.push(current);
      current = [];
    }
  }
  return { rounds, shown };
}

afterEach(() => {
  delete document.documentElement.dataset['voice'];
});

// @traces 006-FR-003
describe('rounds over many Home loads', () => {
  it.each([1, 7, 42, 1234, 99_999])(
    'every round holds each voice exactly once (seed %i)',
    (seed) => {
      const { rounds } = walk(500, seed);

      expect(rounds).toHaveLength(100);
      for (const r of rounds) expect([...r].sort()).toEqual([1, 2, 3, 4, 5]);
    },
  );

  it.each([1, 7, 42, 1234, 99_999])(
    'never shows the same voice on two Home loads in a row (seed %i)',
    (seed) => {
      const { shown } = walk(500, seed);
      const repeats = shown.filter((v, i) => i > 0 && v === shown[i - 1]);

      expect(repeats).toEqual([]);
    },
  );

  it('never starts a round with the voice that ended the last one, when the draw always puts it first', () => {
    const store: Store = new Map();
    const shown: number[] = [];
    for (let i = 0; i < 50; i++)
      shown.push(
        Number(load(store, { at: 10_000_000 + i * 3000, random: () => 0 })),
      );
    const repeats = shown.filter((v, i) => i > 0 && v === shown[i - 1]);

    expect(repeats).toEqual([]);
  });

  it('with two voices on, alternates them on every load', () => {
    const { shown } = walk(40, 3, [2, 4]);

    for (let i = 1; i < shown.length; i++)
      expect(shown[i]).not.toBe(shown[i - 1]);
    expect(new Set(shown)).toEqual(new Set([2, 4]));
  });

  it('shows five different voices on five loads from an empty storage', () => {
    const { shown } = walk(5, 11);

    expect(new Set(shown).size).toBe(5);
  });
});

// @traces 006-FR-004
describe('the 2.5 second rule', () => {
  const stored = (at: string): Store =>
    new Map([
      ['mf-copy', '3'],
      ['mf-copy-deck', '1,5'],
      ['mf-copy-at', at],
    ]);

  it('keeps the voice on a reload in the same millisecond', () => {
    expect(load(stored('1000000'), { at: 1_000_000 })).toBe('3');
  });

  it('advances when the clock went back by one millisecond', () => {
    expect(load(stored('1000000'), { at: 999_999 })).toBe('1');
  });

  it('advances when the clock went back by a day', () => {
    expect(load(stored('1000000000'), { at: 1_000_000_000 - 86_400_000 })).toBe(
      '1',
    );
  });

  it('measures from when the voice was taken, not from the last reload', () => {
    const store = stored('1000000');

    expect(load(store, { at: 1_001_000 })).toBe('3');
    expect(load(store, { at: 1_002_000 })).toBe('3');
    expect(load(store, { at: 1_002_499 })).toBe('3');
    expect(load(store, { at: 1_002_500 })).toBe('1');
  });

  it('stores the time of the new take when it advances', () => {
    const store = stored('1000000');
    load(store, { at: 1_005_000 });

    expect(store.get('mf-copy-at')).toBe('1005000');
  });

  it('leaves the stored time alone on a reload it does not advance', () => {
    const store = stored('1000000');
    load(store, { at: 1_001_000 });

    expect(store.get('mf-copy-at')).toBe('1000000');
  });

  it.each(['abc', '', 'NaN', 'Infinity', '-1', '1e400', '  '])(
    'advances when the stored time is %p',
    (at) => {
      expect(load(stored(at), { at: 1_000_000 })).toBe('1');
    },
  );

  it('does not keep a recent voice that is not a voice', () => {
    const store: Store = new Map([
      ['mf-copy', '9'],
      ['mf-copy-deck', '1,5'],
      ['mf-copy-at', '1000000'],
    ]);

    expect(load(store, { at: 1_000_100 })).toBe('1');
  });

  it('does not keep a recent voice that is switched off', () => {
    const store: Store = new Map([
      ['mf-copy', '3'],
      ['mf-copy-deck', '1,5'],
      ['mf-copy-at', '1000000'],
    ]);

    expect(load(store, { at: 1_000_100, enabled: [1, 2, 4, 5] })).toBe('1');
  });
});

// @traces 006-FR-005
describe('pages that are not Home', () => {
  const stored = (): Store =>
    new Map([
      ['mf-copy', '3'],
      ['mf-copy-deck', '1,5'],
      ['mf-copy-at', '0'],
    ]);

  it.each([
    '/roo',
    '/enx',
    '/ro/garages',
    '/en/x',
    '/ro/garages/',
    '/de',
    '/index.html',
    '/ro/index',
    '/en/results/bmw?x=/',
  ])('keeps the stored voice at %s', (path) => {
    const store = stored();

    expect(load(store, { path })).toBe('3');
    expect(store.get('mf-copy-deck')).toBe('1,5');
    expect(store.get('mf-copy-at')).toBe('0');
  });

  it('keeps the voice across many loads of another page', () => {
    const store = stored();
    for (let i = 0; i < 20; i++)
      expect(load(store, { at: i * 10_000, path: '/ro/garages' })).toBe('3');
    expect(store.get('mf-copy-deck')).toBe('1,5');
  });

  it('starts a round on another page with nothing stored, and the next Home load takes the second voice', () => {
    const store: Store = new Map();
    const first = Number(load(store, { at: 0, path: '/en/x' }));
    const rest = (store.get('mf-copy-deck') ?? '').split(',').map(Number);

    expect([first, ...rest].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(Number(load(store, { at: 10_000, path: '/' }))).toBe(rest[0]);
  });
});

// @traces 006-FR-011
describe('stored values that are not voices', () => {
  it.each([
    ['-1,2', '2'],
    ['true,2', '2'],
    ['null,2', '2'],
    ['constructor,__proto__,2', '2'],
    [',,,,2,,,', '2'],
  ])('drops the entries of %p that are not voices', (deck, expected) => {
    const store: Store = new Map([
      ['mf-copy', '5'],
      ['mf-copy-deck', deck],
      ['mf-copy-at', '0'],
    ]);

    expect(load(store)).toBe(expected);
  });

  it('drops a stored round entry that repeats the voice already shown in this round', () => {
    const store: Store = new Map([
      ['mf-copy', '3'],
      ['mf-copy-deck', '3,1'],
      ['mf-copy-at', '0'],
    ]);

    expect(load(store)).toBe('1');
  });

  it('reads a stored round of ten thousand entries and takes its first voice', () => {
    const deck = Array.from({ length: 10_000 }, (_, i) => (i % 5) + 1).join(
      ',',
    );
    const store: Store = new Map([
      ['mf-copy', '5'],
      ['mf-copy-deck', deck],
      ['mf-copy-at', '0'],
    ]);

    expect(load(store)).toBe('1');
    // 5 was the voice just shown, so it is not this round's to show again.
    expect(store.get('mf-copy-deck')).toBe('2,3,4');
  });

  it.each(['', '0', '6', '3.5', 'x', '{}', '[3]', '3,1'])(
    'on another page, starts a round when the stored voice is %p',
    (mark) => {
      const store: Store = new Map([['mf-copy', mark]]);
      const voice = load(store, { path: '/ro/garages' });

      expect(['1', '2', '3', '4', '5']).toContain(voice);
      expect(store.get('mf-copy')).toBe(voice);
    },
  );

  it('always marks the page with a voice from 1 to 5, whatever was stored', () => {
    const junk = ['', '0', '6', 'x', '1,1', '-', 'NaN', '١', '３'];
    for (const copy of junk)
      for (const deck of junk)
        for (const path of ['/', '/ro/garages']) {
          const store: Store = new Map([
            ['mf-copy', copy],
            ['mf-copy-deck', deck],
            ['mf-copy-at', '0'],
          ]);
          expect(['1', '2', '3', '4', '5']).toContain(load(store, { path }));
        }
  });
});

// @traces 006-FR-009
describe('storage that misbehaves', () => {
  const voices = ['1', '2', '3', '4', '5'];

  it('marks the page with a voice when storage reads but refuses every write', () => {
    const store: Store = new Map([
      ['mf-copy', '3'],
      ['mf-copy-deck', '1,5'],
      ['mf-copy-at', '0'],
    ]);
    const storage: FakeStorage = {
      getItem: (key) => store.get(key) ?? null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    };

    expect(voices).toContain(load(store, { storage }));
    expect(store.get('mf-copy')).toBe('3');
  });

  it('marks the page with a voice when storage refuses only the time', () => {
    const store: Store = new Map();
    const storage: FakeStorage = {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => {
        if (key === 'mf-copy-at')
          throw new DOMException('full', 'QuotaExceededError');
        store.set(key, value);
      },
    };

    expect(voices).toContain(load(store, { storage }));
  });

  it('marks the page with a voice when there is no storage at all', () => {
    expect(voices).toContain(load(new Map(), { storage: null }));
  });

  it('marks the page with a voice when storage returns non-strings', () => {
    const storage = {
      getItem: () => 42 as unknown as string,
      setItem: () => undefined,
    };

    expect(voices).toContain(load(new Map(), { storage }));
  });

  it('marks the page with a voice from 1 to 5 even when the random draw returns 1', () => {
    const storage: FakeStorage = {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
    };

    expect(voices).toContain(
      load(new Map(), { random: () => 0.9999999999999999, storage }),
    );
    expect(voices).toContain(load(new Map(), { random: () => 0, storage }));
  });

  it('starts a round with a draw of exactly 0 and of nearly 1, each voice once', () => {
    for (const random of [() => 0, () => 0.9999999999999999]) {
      const store: Store = new Map();
      const voice = Number(load(store, { random }));
      const rest = (store.get('mf-copy-deck') ?? '').split(',').map(Number);

      expect([voice, ...rest].sort()).toEqual([1, 2, 3, 4, 5]);
    }
  });
});
