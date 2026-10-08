import { isListingDraftData } from '@motor-fix/contracts/listing-sections';

import { loadPlan, readDraft, writeDraft } from './draft';

const FILE = 'listing-photos/0b9f3c1e-6a43-4c55-9d1c-6f3f1b7d2a10/front';

const envelope = (data: unknown, overrides: Record<string, unknown> = {}) => ({
  data,
  dirty: false,
  language: 'ro',
  savedAt: '2026-10-07T11:00:00.000Z',
  step: 2,
  ...overrides,
});

function spyStorage(raw: string | null) {
  const calls = { remove: 0, set: 0 };
  const storage: Storage = {
    clear: () => undefined,
    getItem: () => raw,
    key: () => null,
    length: 0,
    removeItem: () => {
      calls.remove += 1;
    },
    setItem: () => {
      calls.set += 1;
    },
  };
  return { calls, storage };
}

const restore = (data: unknown, overrides: Record<string, unknown> = {}) =>
  readDraft(spyStorage(JSON.stringify(envelope(data, overrides))).storage);

const restoreRaw = (dataJson: string) =>
  readDraft(
    spyStorage(JSON.stringify(envelope(null)).replace('null', dataJson))
      .storage,
  );

const HOSTILE: [string, string][] = [
  ['an own __proto__ key beside steps', '{"__proto__":{"x":1},"steps":{}}'],
  ['a constructor key', '{"constructor":{"prototype":{}}}'],
  ['steps that is a list', '{"steps":[]}'],
  ['steps that is null', '{"steps":null}'],
  ['steps that is text', '{"steps":"1"}'],
  ['survey that is null', '{"survey":null}'],
  ['survey that is a list', '{"survey":[]}'],
  ['files that is null', '{"files":null}'],
  ['files holding null', '{"files":[null]}'],
  ['files holding an object', '{"files":[{"a":1}]}'],
  ['files holding a number', '{"files":[1]}'],
  ['a valid file key followed by a newline', `{"files":["${FILE}\\n"]}`],
  ['a valid file key with a leading space', `{"files":[" ${FILE}"]}`],
  ['a file key with upper-case hex', `{"files":["${FILE.toUpperCase()}"]}`],
  ['a file key with a traversal segment', '{"files":["a/../b/c"]}'],
  ['a file key with a script tag', '{"files":["<script>/x/y"]}'],
  ['an empty file key', '{"files":[""]}'],
  ['a step key of 01', '{"steps":{"01":{}}}'],
  ['a step key of 0', '{"steps":{"0":{}}}'],
  ['a step key with a space', '{"steps":{" 1":{}}}'],
  ['a step key written in full-width digits', '{"steps":{"１":{}}}'],
  ['a step 2 section that is a list', '{"steps":{"2":[]}}'],
  ['a step 2 section that is null', '{"steps":{"2":null}}'],
  ['a step 1 section that is a list', '{"steps":{"1":[]}}'],
  ['a step 1 name that is a number', '{"steps":{"1":{"name":5}}}'],
  ['a step 1 unknown business kind', '{"steps":{"1":{"businessKind":"llc"}}}'],
  ['a step 3 jobs value that is text', '{"steps":{"3":{"jobs":"x"}}}'],
  ['a step 4 mechanics that is null', '{"steps":{"4":{"mechanics":null}}}'],
  ['a step 6 section that is text', '{"steps":{"6":"cui"}}'],
  ['a step beyond six beside valid ones', '{"steps":{"1":{},"7":{}}}'],
  ['a key beside a full envelope', '{"steps":{},"files":[],"extra":null}'],
];

describe('restoring a stored draft with hostile form data', () => {
  it.each(HOSTILE)('restores nothing for %s', (_title, data) => {
    expect(restoreRaw(data)).toEqual({ blocked: false, draft: null });
  });

  it('does not use the token of a refused entry, dirty or not', () => {
    const dirty = restore(
      { other: 1 },
      { dirty: true, draftId: 'd', token: 't' },
    );
    const clean = restore({ other: 1 }, { draftId: 'd', token: 't' });

    expect(loadPlan(dirty.draft)).toEqual({ kind: 'empty' });
    expect(loadPlan(clean.draft)).toEqual({ kind: 'empty' });
  });

  it('still lets a continue link fetch when the stored entry is refused', () => {
    const { draft } = restore({ other: 1 }, { token: 'old' });

    expect(loadPlan(draft, 'from-link')).toEqual({
      keep: null,
      kind: 'fetch',
      token: 'from-link',
    });
  });

  it('leaves the refused entry in storage and writes nothing on read', () => {
    const { calls, storage } = spyStorage(
      JSON.stringify(envelope({ other: 1 })),
    );

    readDraft(storage);
    readDraft(storage);

    expect(calls).toEqual({ remove: 0, set: 0 });
  });

  it('gives the same answer when read twice', () => {
    const { storage } = spyStorage(JSON.stringify(envelope({ files: 'x' })));

    expect(readDraft(storage)).toEqual(readDraft(storage));
  });

  it('refuses a long file list that ends in one bad key', () => {
    const files = Array.from({ length: 10_000 }, () => FILE);
    files.push('nope');

    expect(restore({ files }).draft).toBeNull();
  });

  it('restores a long list of well-formed file keys unchanged', () => {
    const files = Array.from({ length: 10_000 }, () => FILE);

    expect(restore({ files }).draft?.data).toEqual({ files });
  });

  it('reports a storage that throws on read as blocked', () => {
    const storage = {
      getItem: () => {
        throw new Error('denied');
      },
    } as unknown as Storage;

    expect(readDraft(storage)).toEqual({ blocked: true, draft: null });
  });

  it('reads nothing from text that starts with a byte order mark', () => {
    const raw = `﻿${JSON.stringify(envelope({ other: 1 }))}`;

    expect(readDraft(spyStorage(raw).storage).draft).toBeNull();
  });

  it('reads nothing from stored text that is not JSON at all', () => {
    expect(readDraft(spyStorage('éè{').storage).draft).toBeNull();
  });
});

describe('restoring a valid stored draft', () => {
  it('keeps unicode and a deep survey exactly as stored', () => {
    const data = {
      files: [FILE],
      steps: { '1': { name: 'Șerban Îngrijire Auto ăâîșț' } },
      survey: {
        heard: ['a', { deep: { deeper: [1, 2, null] } }],
        note: '日本語',
      },
    };
    const { draft } = restore(data, { step: 6 });

    expect(draft?.data).toEqual(data);
    expect(draft?.step).toBe(6);
  });

  it('restores empty steps without files', () => {
    expect(restore({ steps: {} }).draft?.data).toEqual({ steps: {} });
  });

  it('restores a dirty valid entry with a token as a push', () => {
    const { draft } = restore({}, { dirty: true, draftId: 'd', token: 't' });

    expect(draft).not.toBeNull();
    expect(loadPlan(draft)).toEqual({ draft, kind: 'push' });
  });

  it('round-trips what writeDraft stored', () => {
    let stored = '';
    const storage = spyStorage(null).storage;
    storage.setItem = (_key, value) => {
      stored = value;
    };
    const draft = {
      data: { files: [FILE], steps: { '1': { name: 'Service' } } },
      dirty: true,
      language: 'en' as const,
      savedAt: '2026-10-07T11:00:00.000Z',
      step: 3,
    };

    writeDraft(storage, draft);

    expect(readDraft(spyStorage(stored).storage).draft).toEqual(draft);
  });
});

describe('the browser verdict and the server rule', () => {
  const verdicts: [string, unknown][] = [
    ...HOSTILE.map(([title, raw]): [string, unknown] => [
      title,
      JSON.parse(raw),
    ]),
    ['nothing yet', {}],
    ['an empty steps', { steps: {} }],
    ['a photo', { files: [FILE] }],
    ['a survey', { survey: { a: 1 } }],
    ['a list', []],
    ['text', 'draft'],
    ['a step 2 with anything', { steps: { '2': { anything: [1] } } }],
    ['a step 5 empty', { steps: { '5': {} } }],
    ['a step 1 name at 80', { steps: { '1': { name: 'a'.repeat(80) } } }],
    ['a step 1 name at 81', { steps: { '1': { name: 'a'.repeat(81) } } }],
    ['a step 1 name at 160', { steps: { '1': { name: 'a'.repeat(160) } } }],
    ['a step 1 name at 161', { steps: { '1': { name: 'a'.repeat(161) } } }],
  ];

  it.each(verdicts)('agree on %s', (_title, data) => {
    const { draft } = restore(data);
    const accepted = isListingDraftData(data);

    expect(draft !== null).toBe(accepted);
    if (accepted) expect(draft?.data).toEqual(data);
  });
});
