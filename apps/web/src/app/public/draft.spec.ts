import type { ListingDraftDto } from '@motor-fix/data-access';

import {
  BROWSER_SAVE_MS,
  type BrowserDraft,
  changed,
  confirmed,
  failed,
  fromServer,
  loadPlan,
  readDraft,
  SERVER_SAVE_MS,
  STORAGE_KEY,
  startAgain,
  writeDraft,
} from './draft';

const NOW = new Date('2026-10-07T12:00:00Z');

const entry = (overrides: Partial<BrowserDraft> = {}): BrowserDraft => ({
  data: { steps: { '1': { name: 'Service Popescu' } } },
  dirty: false,
  language: 'ro',
  savedAt: '2026-10-07T11:00:00.000Z',
  step: 2,
  ...overrides,
});

function memory(): Storage {
  const items = new Map<string, string>();
  return {
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (i) => [...items.keys()][i] ?? null,
    get length() {
      return items.size;
    },
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
}

const throwing = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
} as unknown as Storage;

describe('the browser copy of a listing draft', () => {
  it('waits a second of stillness for the browser and five for the server', () => {
    expect(BROWSER_SAVE_MS).toBe(1_000);
    expect(SERVER_SAVE_MS).toBe(5_000);
  });

  it('keeps one entry under its own key and reads it back', () => {
    const storage = memory();

    expect(writeDraft(storage, entry())).toBe(true);

    expect(JSON.parse(storage.getItem(STORAGE_KEY) ?? '')).toEqual(entry());
    expect(readDraft(storage)).toEqual({ blocked: false, draft: entry() });
    expect(STORAGE_KEY).toBe('mf.listing-draft');
  });

  it('reads nothing from an empty or unreadable entry', () => {
    const storage = memory();
    expect(readDraft(storage)).toEqual({ blocked: false, draft: null });

    storage.setItem(STORAGE_KEY, '{not json');
    expect(readDraft(storage)).toEqual({ blocked: false, draft: null });

    storage.setItem(STORAGE_KEY, JSON.stringify({ step: 9 }));
    expect(readDraft(storage).draft).toBeNull();
  });

  it('reports a browser that keeps nothing, and never throws for it', () => {
    expect(readDraft(throwing)).toEqual({ blocked: true, draft: null });
    expect(writeDraft(throwing, entry())).toBe(false);
    expect(readDraft(null)).toEqual({ blocked: true, draft: null });
    expect(writeDraft(null, entry())).toBe(false);
  });

  it('marks a change dirty only once the server holds a copy', () => {
    const local = changed(entry(), { step: 3 }, NOW);
    expect(local).toMatchObject({
      dirty: false,
      savedAt: NOW.toISOString(),
      step: 3,
    });

    const held = changed(
      entry({ draftId: 'd1', token: 't1' }),
      { data: { survey: { note: 'x' } } },
      NOW,
    );
    expect(held).toMatchObject({
      data: { survey: { note: 'x' } },
      dirty: true,
    });
  });

  it('clears the mark when the server confirms, taking a new key if one came', () => {
    const dirty = entry({ dirty: true, draftId: 'd1', token: 't1' });

    expect(confirmed(dirty, { id: 'd1' })).toMatchObject({
      dirty: false,
      draftId: 'd1',
      token: 't1',
    });
    expect(confirmed(dirty, { id: 'd1', token: 't2' })).toMatchObject({
      dirty: false,
      token: 't2',
    });
  });

  it('keeps the copy and the mark when a save fails', () => {
    expect(failed(entry({ draftId: 'd1', token: 't1' }))).toMatchObject({
      data: entry().data,
      dirty: true,
    });
  });

  it('takes the server copy whole, with the key that opened it', () => {
    const server: ListingDraftDto = {
      data: { steps: { '2': { brands: ['Dacia'] } } },
      email: 'owner@example.test',
      id: 'd9',
      language: 'en',
      status: 'open',
      step: 4,
      updatedAt: '2026-10-07T10:00:00.000Z',
    };

    expect(fromServer(server, 'link-token', NOW)).toEqual({
      data: server.data,
      dirty: false,
      draftId: 'd9',
      email: 'owner@example.test',
      language: 'en',
      savedAt: NOW.toISOString(),
      step: 4,
      token: 'link-token',
    });
  });

  it('starts again from an empty form with no server copy', () => {
    const again = startAgain(
      entry({ dirty: true, draftId: 'd1', email: 'a@b.test', token: 't1' }),
      NOW,
    );

    expect(again).toEqual({
      data: {},
      dirty: false,
      language: entry().language,
      savedAt: NOW.toISOString(),
      step: 1,
    });
  });
});

describe('what the page does with the copy on load', () => {
  it('opens an empty form when there is nothing', () => {
    expect(loadPlan(null)).toEqual({ kind: 'empty' });
  });

  it('shows a copy the server never had, and pushes nothing', () => {
    expect(loadPlan(entry())).toEqual({ draft: entry(), kind: 'local' });
  });

  it('shows a dirty copy and pushes it, rather than fetching', () => {
    const dirty = entry({ dirty: true, draftId: 'd1', token: 't1' });

    expect(loadPlan(dirty)).toEqual({ draft: dirty, kind: 'push' });
  });

  it('fetches the server copy for a clean entry that holds a key', () => {
    const clean = entry({ draftId: 'd1', token: 't1' });

    expect(loadPlan(clean)).toEqual({
      keep: clean,
      kind: 'fetch',
      token: 't1',
    });
  });

  it('lets a link replace whatever the browser held, dirty included', () => {
    const dirty = entry({ dirty: true, draftId: 'd1', token: 't1' });

    expect(loadPlan(dirty, 'from-link')).toEqual({
      keep: dirty,
      kind: 'fetch',
      token: 'from-link',
    });
    expect(loadPlan(null, 'from-link')).toEqual({
      keep: null,
      kind: 'fetch',
      token: 'from-link',
    });
  });
});

describe('a stored copy whose form data the server would refuse', () => {
  const FILE = 'listing-photos/0b9f3c1e-6a43-4c55-9d1c-6f3f1b7d2a10/front';
  const holding = (data: unknown, overrides: Partial<BrowserDraft> = {}) => {
    const storage = memory();
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...entry(overrides), data }));
    return storage;
  };

  it.each([
    ['a key beside steps, survey and files', { other: 1, steps: {} }],
    ['a section under a step the form does not have', { steps: { '7': {} } }],
    [
      'a step 1 name longer than any field',
      { steps: { '1': { name: 'a'.repeat(200) } } },
    ],
    ['a step 6 tax ID that is not text', { steps: { '6': { cui: 18547290 } } }],
    ['a file key of the wrong shape', { files: ['../etc/passwd'] }],
    ['files that are not a list', { files: FILE }],
    ['a survey that is not an object', { survey: 'yes' }],
    ['data that is a list', [{ steps: {} }]],
  ])('is not restored when it holds %s, and nothing throws', (_, data) => {
    const storage = holding(data);

    expect(() => readDraft(storage)).not.toThrow();
    expect(readDraft(storage)).toEqual({ blocked: false, draft: null });
  });

  it('is dropped whole when it also holds a server key, so nothing is fetched or pushed', () => {
    const storage = holding(
      { other: 1 },
      { dirty: true, draftId: 'd1', token: 't1' },
    );

    const { draft } = readDraft(storage);

    expect(draft).toBeNull();
    expect(loadPlan(draft)).toEqual({ kind: 'empty' });
  });

  it.each([
    ['nothing yet', {}],
    [
      'no steps but a survey and a photo',
      { files: [FILE], survey: { heard: 'friend' } },
    ],
    [
      'a section for every step',
      {
        files: [FILE],
        steps: {
          '1': { businessKind: 'pfa', name: 'Service Ion' },
          '2': { anything: 1 },
          '3': { jobs: [], labour: {} },
          '4': { mechanics: [{ name: 'Ion' }], onProfile: true },
          '5': {},
          '6': { cui: '18547290', rarNumber: 'RAR-123' },
        },
        survey: {},
      },
    ],
  ])('is restored as before when it holds %s', (_, data) => {
    const kept = entry({ data: data as BrowserDraft['data'] });
    const storage = memory();
    writeDraft(storage, kept);

    expect(readDraft(storage)).toEqual({ blocked: false, draft: kept });
  });

  it('still pushes a dirty copy that passes, rather than fetching', () => {
    const dirty = entry({ dirty: true, draftId: 'd1', token: 't1' });
    const storage = memory();
    writeDraft(storage, dirty);

    expect(loadPlan(readDraft(storage).draft)).toEqual({
      draft: dirty,
      kind: 'push',
    });
  });
});
