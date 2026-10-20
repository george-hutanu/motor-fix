import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { isListingDraftData } from '@motor-fix/contracts/listing-sections';
import {
  type ListingDraftDto,
  ListingDraftsService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

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
import { DraftKeeper } from './draft-keeper';
import { Consent } from '../../consent/consent';

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

const FILE = 'listing-photos/0b9f3c1e-6a43-4c55-9d1c-6f3f1b7d2a10/front';
const REFUSED: [string, unknown][] = [
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
  // @traces 1359-FR-008
  ['a survey with an unknown key', { survey: { heard: 'friend' } }],
  ['a survey answer outside its codes', { survey: { mechanicsCount: '7' } }],
  ['a survey yes that is text', { survey: { wantsLiveMedia: 'da' } }],
  ['data that is a list', [{ steps: {} }]],
];
const PASSING: [string, unknown][] = [
  ['nothing yet', {}],
  [
    'no steps but a survey and a photo',
    { files: [FILE], survey: { liftsCount: '2-3', mechanicsCount: '0' } },
  ],
  [
    'a section for every step',
    {
      files: [FILE],
      steps: {
        '1': { businessKind: 'pfa', name: 'Service Ion' },
        '2': { brands: [] },
        '3': { jobs: [], labour: {} },
        '4': { mechanics: [{ name: 'Ion' }], onProfile: true },
        '5': {},
        '6': { cui: '18547290', rarNumber: 'RAR-123' },
      },
      survey: {},
    },
  ],
];

describe('a stored copy whose form data the server would refuse', () => {
  const holding = (data: unknown, overrides: Partial<BrowserDraft> = {}) => {
    const storage = memory();
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...entry(overrides), data }));
    return storage;
  };

  it.each(REFUSED)(
    'is not restored when it holds %s, and nothing throws',
    (_, data) => {
      const storage = holding(data);

      expect(() => readDraft(storage)).not.toThrow();
      expect(readDraft(storage)).toEqual({ blocked: false, draft: null });
    },
  );

  it('is dropped whole when it also holds a server key, so nothing is fetched or pushed', () => {
    const storage = holding(
      { other: 1 },
      { dirty: true, draftId: 'd1', token: 't1' },
    );

    const { draft } = readDraft(storage);

    expect(draft).toBeNull();
    expect(loadPlan(draft)).toEqual({ kind: 'empty' });
  });

  it.each(PASSING)('is restored as before when it holds %s', (_, data) => {
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

  it.each([...REFUSED, ...PASSING])(
    'gets the same verdict as the server rule when it holds %s',
    (_, data) => {
      const restored = readDraft(holding(data)).draft !== null;

      expect(restored).toBe(isListingDraftData(data));
    },
  );
});

describe('DraftKeeper before the check', () => {
  const missing = [{ code: 'required', field: 'steps.1.phone' }];
  const told = [{ code: 'document_missing', field: 'documents.x' }];
  let api: Record<string, jest.Mock>;
  let track: jest.Mock;

  function keeper(draft: Partial<BrowserDraft> = {}) {
    track = jest.fn();
    api = {
      listingDraftsControllerCheck: jest.fn().mockResolvedValue({
        warnings: told,
      }),
      listingDraftsControllerCreate: jest.fn().mockResolvedValue({
        email: 'ana@service.ro',
        id: 'd1',
        token: 't1',
      }),
      listingDraftsControllerSave: jest.fn().mockResolvedValue({ id: 'd1' }),
      listingDraftsControllerSendLink: jest.fn().mockResolvedValue({}),
    };
    TestBed.configureTestingModule({
      providers: [
        DraftKeeper,
        { provide: Consent, useValue: { track } },
        { provide: ListingDraftsService, useValue: api },
        { provide: I18n, useValue: { language: () => 'ro' } },
        { provide: Router, useValue: { navigate: jest.fn() } },
      ],
    });
    const kept = TestBed.inject(DraftKeeper);
    kept.draft.set(entry({ email: 'ana@service.ro', ...draft }));
    return kept;
  }

  const refusal = (status: number, error: object = {}) =>
    new HttpErrorResponse({ error, status });

  afterEach(() => TestBed.resetTestingModule());

  // @traces 115-FR-009
  it('creates the server copy when there is none, and sends no link', async () => {
    const kept = keeper({ dirty: true });

    expect(await kept.flush()).toBe(true);
    expect(api['listingDraftsControllerCreate']).toHaveBeenCalledTimes(1);
    expect(api['listingDraftsControllerSendLink']).not.toHaveBeenCalled();
    expect(kept.draft().draftId).toBe('d1');
  });

  // @traces 250-FR-005
  it('tells a listing started once its first server copy exists', async () => {
    const kept = keeper({ dirty: true });

    expect(await kept.flush()).toBe(true);
    kept.section('1', { name: 'Service Ionescu' });
    expect(await kept.flush()).toBe(true);

    expect(api['listingDraftsControllerSave']).toHaveBeenCalledTimes(1);
    expect(track.mock.calls).toEqual([['listing_started']]);
  });

  // @traces 250-FR-005
  it('tells nothing for a draft whose server copy already exists, or was refused', async () => {
    const saved = keeper({ dirty: true, draftId: 'd1', token: 't1' });
    expect(await saved.flush()).toBe(true);
    expect(track).not.toHaveBeenCalled();
    TestBed.resetTestingModule();

    const refused = keeper({ dirty: true });
    api['listingDraftsControllerCreate'].mockRejectedValue(refusal(500));
    expect(await refused.flush()).toBe(false);

    expect(track).not.toHaveBeenCalled();
  });

  // @traces 115-FR-009
  it('saves a changed server copy, and leaves a clean one alone', async () => {
    const kept = keeper({ dirty: true, draftId: 'd1', token: 't1' });

    expect(await kept.flush()).toBe(true);
    expect(api['listingDraftsControllerSave']).toHaveBeenCalledTimes(1);
    expect(kept.draft().dirty).toBe(false);
    expect(await kept.flush()).toBe(true);
    expect(api['listingDraftsControllerSave']).toHaveBeenCalledTimes(1);
    expect(api['listingDraftsControllerSendLink']).not.toHaveBeenCalled();
  });

  // @traces 115-FR-011
  it('answers false on a refused save, keeping what was typed', async () => {
    const kept = keeper({ dirty: true, draftId: 'd1', token: 't1' });
    api['listingDraftsControllerSave'].mockRejectedValue(refusal(500));

    expect(await kept.flush()).toBe(false);
    expect(kept.draft().data).toEqual(entry().data);
  });

  // @traces 115-FR-009
  it('waits for a save already on its way, then saves what came after', async () => {
    const kept = keeper({ dirty: true, draftId: 'd1', token: 't1' });
    let answer: (value: object) => void = () => undefined;
    api['listingDraftsControllerSave'].mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    kept.leaveEmail();
    kept.section('1', { name: 'Service Ionescu' });

    const flushed = kept.flush();
    answer({ id: 'd1' });

    expect(await flushed).toBe(true);
    expect(api['listingDraftsControllerSave']).toHaveBeenCalledTimes(2);
    expect(kept.draft().dirty).toBe(false);
  });

  // @traces 115-FR-011
  it('gives up, keeping the draft, when every save leaves something new to save', async () => {
    const kept = keeper({ dirty: true, draftId: 'd1', token: 't1' });
    let n = 0;
    api['listingDraftsControllerSave'].mockImplementation(async () => {
      n += 1;
      if (n <= 20) {
        kept.section('1', { name: `Service ${n}` });
        // A change typed within the same millisecond still counts as one.
        kept.draft.update((draft) => ({ ...draft, savedAt: `change ${n}` }));
      }
      return { id: 'd1' };
    });

    expect(await kept.flush()).toBe(false);
    expect(n).toBeLessThan(20);
    expect(api['listingDraftsControllerCheck']).not.toHaveBeenCalled();
  });

  // @traces 115-FR-010
  it('checks only after the flush, and tells complete with its warnings', async () => {
    const kept = keeper({ dirty: true, draftId: 'd1', token: 't1' });

    expect(await kept.check()).toEqual({ kind: 'complete', warnings: told });
    const [saved] = api['listingDraftsControllerSave'].mock.invocationCallOrder;
    const [checked] =
      api['listingDraftsControllerCheck'].mock.invocationCallOrder;
    expect(saved).toBeLessThan(checked as number);
  });

  // @traces 115-FR-010
  it('tells the server list on a 422', async () => {
    const kept = keeper({ draftId: 'd1', token: 't1' });
    api['listingDraftsControllerCheck'].mockRejectedValue(
      refusal(422, {
        code: 'listing_incomplete',
        errors: missing,
        warnings: told,
      }),
    );

    expect(await kept.check()).toEqual({
      errors: missing,
      kind: 'incomplete',
      warnings: told,
    });
  });

  // @traces 115-FR-011
  it('sends no check when the flush fails, and fails on any other answer', async () => {
    const kept = keeper({ dirty: true, draftId: 'd1', token: 't1' });
    api['listingDraftsControllerSave'].mockRejectedValueOnce(refusal(0));

    expect(await kept.check()).toEqual({ kind: 'failed' });
    expect(api['listingDraftsControllerCheck']).not.toHaveBeenCalled();

    api['listingDraftsControllerCheck'].mockRejectedValue(refusal(500));
    expect(await kept.check()).toEqual({ kind: 'failed' });
    expect(kept.note()).toEqual({ key: 'notSaved' });
  });

  // @traces 115-FR-011
  it('moves the view when the draft is gone or already sent', async () => {
    const kept = keeper({ draftId: 'd1', token: 't1' });
    api['listingDraftsControllerCheck'].mockRejectedValueOnce(refusal(409));

    expect(await kept.check()).toEqual({ kind: 'failed' });
    expect(kept.view()).toBe('sent');
  });

  // @traces 1359-FR-009
  it('keeps survey answers beside the steps and asks the server at once', async () => {
    const kept = keeper({ draftId: 'd1', token: 't1' });

    kept.survey({ mechanicsCount: '1-2' });
    await Promise.resolve();

    expect(kept.draft().data).toEqual({
      ...entry().data,
      survey: { mechanicsCount: '1-2' },
    });
    expect(api['listingDraftsControllerSave']).toHaveBeenCalledTimes(1);
    expect(
      api['listingDraftsControllerSave'].mock.calls[0][0].body.data.survey,
    ).toEqual({ mechanicsCount: '1-2' });
  });

  // @traces 1359-FR-009
  it('carries the answers on the next save after one that failed', async () => {
    const kept = keeper({ draftId: 'd1', token: 't1' });
    api['listingDraftsControllerSave'].mockRejectedValueOnce(refusal(0));

    kept.survey({ mechanicsCount: '0' });
    await new Promise((resolve) => setTimeout(resolve));
    kept.survey({ liftsCount: '1', mechanicsCount: '0' });
    await new Promise((resolve) => setTimeout(resolve));

    const calls = api['listingDraftsControllerSave'].mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1][0].body.data.survey).toEqual({
      liftsCount: '1',
      mechanicsCount: '0',
    });
  });
});
