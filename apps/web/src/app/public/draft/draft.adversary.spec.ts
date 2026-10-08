import {
  type BrowserDraft,
  changed,
  confirmed,
  failed,
  loadPlan,
  readDraft,
  STORAGE_KEY,
  startAgain,
  writeDraft,
} from './draft';

const NOW = new Date('2026-10-07T12:00:00Z');

const entry = (overrides: Record<string, unknown> = {}) => ({
  data: { steps: { '1': { name: 'Service' } } },
  dirty: false,
  language: 'ro',
  savedAt: '2026-10-07T11:00:00.000Z',
  step: 2,
  ...overrides,
});

function storageWith(raw: string | null): Storage {
  return {
    clear: () => undefined,
    getItem: () => raw,
    key: () => null,
    length: 0,
    removeItem: () => undefined,
    setItem: () => undefined,
  };
}

const read = (value: unknown) =>
  readDraft(storageWith(JSON.stringify(value))).draft;

describe('reading a hostile browser entry', () => {
  it.each([
    ['step zero', { step: 0 }],
    ['step seven', { step: 7 }],
    ['a fractional step', { step: 2.5 }],
    ['a step written as text', { step: '2' }],
    ['a negative step', { step: -1 }],
    ['an unknown language', { language: 'fr' }],
    ['an upper-case language', { language: 'RO' }],
    ['a dirty mark written as text', { dirty: 'true' }],
    ['data that is null', { data: null }],
    ['data that is text', { data: 'steps' }],
    ['data that is a list', { data: [] }],
  ])('discards an entry with %s', (_title, patch) => {
    expect(read(entry(patch))).toBeNull();
  });

  it.each([
    ['a number', 123],
    ['an object', { $ne: '' }],
    ['a list', ['a']],
  ])('discards an entry whose key is %s', (_title, token) => {
    expect(read(entry({ token }))).toBeNull();
  });

  it.each(['null', '[]', '42', '"text"', 'true', '', '{}'])(
    'reads nothing from the stored text %p',
    (raw) => {
      expect(readDraft(storageWith(raw))).toEqual({
        blocked: false,
        draft: null,
      });
    },
  );

  it('accepts the first and the sixth step', () => {
    expect(read(entry({ step: 1 }))?.step).toBe(1);
    expect(read(entry({ step: 6 }))?.step).toBe(6);
  });

  it('keeps unicode in the data through a write and a read', () => {
    const storage = storageWith(null);
    let stored = '';
    storage.setItem = (_k, v) => {
      stored = v;
    };
    const draft = entry({
      data: { steps: { '1': { name: 'Șoseaua Ștefan cel Mare 🚗' } } },
    }) as BrowserDraft;

    expect(writeDraft(storage, draft)).toBe(true);
    storage.getItem = () => stored;

    expect(readDraft(storage).draft).toEqual(draft);
  });

  it('writes under the one storage key', () => {
    const keys: string[] = [];
    const storage = storageWith(null);
    storage.setItem = (k) => {
      keys.push(k);
    };

    writeDraft(storage, entry() as BrowserDraft);

    expect(keys).toEqual([STORAGE_KEY]);
  });
});

describe('transitions leave their input alone', () => {
  const held = (): BrowserDraft =>
    entry({ dirty: true, draftId: 'd1', token: 't1' }) as BrowserDraft;

  it('changed returns a new draft and does not touch the old one', () => {
    const before = held();
    const snapshot = JSON.parse(JSON.stringify(before));

    const after = changed(before, { step: 5 }, NOW);

    expect(before).toEqual(snapshot);
    expect(after).not.toBe(before);
  });

  it('confirmed and failed do not mutate their input', () => {
    const before = held();
    const snapshot = JSON.parse(JSON.stringify(before));

    confirmed(before, { id: 'd1', token: 't2' });
    failed(before);

    expect(before).toEqual(snapshot);
  });

  it('startAgain drops the key and the id even when changes were pending', () => {
    const before = held();

    const again = startAgain(before);

    expect(again).not.toHaveProperty('draftId');
    expect(again).not.toHaveProperty('token');
    expect(again.dirty).toBe(false);
    expect(before.token).toBe('t1');
  });

  it('a change before any server copy exists never marks the entry dirty', () => {
    const local = entry({ token: undefined }) as BrowserDraft;

    expect(changed(local, { email: 'a@b.co', step: 3 }, NOW).dirty).toBe(false);
  });

  it('a confirmed save without a new key keeps the old key', () => {
    expect(confirmed(held(), { id: 'd1' }).token).toBe('t1');
  });
});

describe('choosing what to load', () => {
  const dirtyKeyed = entry({ dirty: true, token: 't1' }) as BrowserDraft;
  const cleanKeyed = entry({ token: 't1' }) as BrowserDraft;
  const unkeyed = entry() as BrowserDraft;

  it('treats an empty link token as no link', () => {
    expect(loadPlan(null, '')).toEqual({ kind: 'empty' });
    expect(loadPlan(cleanKeyed, '')).toEqual({
      keep: cleanKeyed,
      kind: 'fetch',
      token: 't1',
    });
  });

  it('a link beats a dirty copy and hands it back as the one to keep', () => {
    expect(loadPlan(dirtyKeyed, 'link')).toEqual({
      keep: dirtyKeyed,
      kind: 'fetch',
      token: 'link',
    });
  });

  it('a link with no browser copy keeps nothing', () => {
    expect(loadPlan(null, 'link')).toEqual({
      keep: null,
      kind: 'fetch',
      token: 'link',
    });
  });

  it('a dirty copy without a key is only local, since there is nowhere to push it', () => {
    const lost = entry({ dirty: true }) as BrowserDraft;

    expect(loadPlan(lost)).toEqual({ draft: lost, kind: 'local' });
  });

  it('an empty key on a dirty copy is not a key', () => {
    const blank = entry({ dirty: true, token: '' }) as BrowserDraft;

    expect(loadPlan(blank)).toEqual({ draft: blank, kind: 'local' });
  });

  it('a clean copy with no key stays local', () => {
    expect(loadPlan(unkeyed)).toEqual({ draft: unkeyed, kind: 'local' });
  });
});
