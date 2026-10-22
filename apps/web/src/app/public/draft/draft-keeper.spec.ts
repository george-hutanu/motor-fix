import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import {
  type CompletionCopyDto,
  ListingDraftsService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import type { BrowserDraft } from './draft';
import { DraftKeeper } from './draft-keeper';
import { Consent } from '../../consent/consent';

const entry = (overrides: Partial<BrowserDraft> = {}): BrowserDraft => ({
  data: { steps: { '1': { name: 'Service Popescu' } } },
  dirty: false,
  language: 'ro',
  savedAt: '2026-10-07T11:00:00.000Z',
  step: 2,
  ...overrides,
});

// @traces 208-FR-016
describe('DraftKeeper before the check', () => {
  const SENT = {
    fileId: 'f1',
    garageId: 'g1',
    status: 'submitted',
    warnings: [],
  };
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
      listingSubmitControllerSubmit: jest.fn().mockResolvedValue(SENT),
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

  describe('sending the listing', () => {
    // @traces 116-FR-006
    it('sends the draft under its key once the flush is done, and answers what was made', async () => {
      const kept = keeper({ dirty: true, draftId: 'd1', token: 't1' });

      expect(await kept.submit('k-1')).toEqual({ kind: 'sent', result: SENT });
      expect(api['listingSubmitControllerSubmit']).toHaveBeenCalledWith({
        'Idempotency-Key': 'k-1',
        id: 'd1',
        'x-listing-token': 't1',
      });
      const [saved] =
        api['listingDraftsControllerSave'].mock.invocationCallOrder;
      const [sent] =
        api['listingSubmitControllerSubmit'].mock.invocationCallOrder;
      expect(saved).toBeLessThan(sent as number);
    });

    // @traces 116-FR-006
    it('sends nothing when the flush fails', async () => {
      const kept = keeper({ dirty: true, draftId: 'd1', token: 't1' });
      api['listingDraftsControllerSave'].mockRejectedValue(refusal(500));

      expect(await kept.submit('k-1')).toEqual({ kind: 'failed' });
      expect(api['listingSubmitControllerSubmit']).not.toHaveBeenCalled();
    });

    // @traces 116-FR-009
    it('tells an account that already owns a garage apart, keeping the form', async () => {
      const kept = keeper({ draftId: 'd1', token: 't1' });
      api['listingSubmitControllerSubmit'].mockRejectedValue(
        refusal(409, { code: 'garage_already_exists' }),
      );

      expect(await kept.submit('k-1')).toEqual({ kind: 'owner' });
      expect(kept.view()).toBe('form');
    });

    // @traces 116-FR-006
    it('ends the form when the draft was already sent under another key', async () => {
      const kept = keeper({ draftId: 'd1', token: 't1' });
      api['listingSubmitControllerSubmit'].mockRejectedValue(
        refusal(409, { code: 'draft_already_submitted' }),
      );

      expect(await kept.submit('k-1')).toEqual({ kind: 'failed' });
      expect(kept.view()).toBe('sent');
    });

    // @traces 116-FR-006
    it('answers the server list on a 422', async () => {
      const kept = keeper({ draftId: 'd1', token: 't1' });
      api['listingSubmitControllerSubmit'].mockRejectedValue(
        refusal(422, {
          code: 'validation_failed',
          errors: [{ code: 'required', field: 'survey' }],
          warnings: told,
        }),
      );

      expect(await kept.submit('k-1')).toEqual({
        errors: [{ code: 'required', field: 'survey' }],
        kind: 'incomplete',
        warnings: told,
      });
    });

    // @traces 116-FR-006
    it('fails on any other answer without a draft note, so the page can offer it again', async () => {
      const kept = keeper({ draftId: 'd1', token: 't1' });
      api['listingSubmitControllerSubmit'].mockRejectedValue(refusal(500));

      expect(await kept.submit('k-1')).toEqual({ kind: 'failed' });
      expect(kept.note()).toBeNull();
      expect(kept.view()).toBe('form');
    });
  });
});

describe('DraftKeeper over a completion copy', () => {
  const COPY: CompletionCopyDto = {
    data: {
      files: ['garage-photos/3f1b7d2a-6a43-4c55-9d1c-6f3f1b7d2a10/p1'],
      steps: { '1': { name: 'Service Popescu' } },
    },
    edited: false,
    email: 'ana@service.ro',
    held: [{ issuedOn: null, kind: 'rar_authorisation', pages: 1 }],
    id: 'c1',
    language: 'ro',
    requestedItems: ['photos'],
    status: 'open',
    step: 5,
    token: 'ct',
    updatedAt: '2026-10-21T10:00:00.000Z',
  };
  let api: Record<string, jest.Mock>;

  function keeper() {
    api = {
      completionControllerOpen: jest.fn().mockResolvedValue(COPY),
      listingDraftsControllerSave: jest.fn().mockResolvedValue({ id: 'c1' }),
      listingSubmitControllerSubmit: jest.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        DraftKeeper,
        { provide: Consent, useValue: { track: jest.fn() } },
        { provide: ListingDraftsService, useValue: api },
        { provide: I18n, useValue: { language: () => 'ro' } },
        { provide: Router, useValue: { navigate: jest.fn() } },
      ],
    });
    return TestBed.inject(DraftKeeper);
  }

  afterEach(() => TestBed.resetTestingModule());

  // @traces 208-FR-005
  it('opens the copy and takes it whole, under its own key', async () => {
    const kept = keeper();
    kept.draft.set(entry({ dirty: true, draftId: 'd9', token: 't9' }));

    expect(await kept.openCopy()).toEqual(COPY);

    expect(kept.draft()).toMatchObject({
      data: COPY.data,
      dirty: false,
      draftId: 'c1',
      email: 'ana@service.ro',
      step: 5,
      token: 'ct',
    });
    expect(kept.view()).toBe('form');
  });

  // @traces 208-FR-005
  it('answers null and keeps the form as it was when no copy opens', async () => {
    const kept = keeper();
    kept.draft.set(entry());
    api['completionControllerOpen'].mockRejectedValue(
      new HttpErrorResponse({
        error: { code: 'verification_transition_refused' },
        status: 409,
      }),
    );

    expect(await kept.openCopy()).toBeNull();
    expect(kept.draft()).toEqual(entry());
  });

  // @traces 208-FR-005
  it('throws a failure that is no answer, the form left as it was with its note', async () => {
    const kept = keeper();
    kept.draft.set(entry());
    const down = new HttpErrorResponse({ status: 503 });
    api['completionControllerOpen'].mockRejectedValue(down);

    await expect(kept.openCopy()).rejects.toBe(down);
    expect(kept.draft()).toEqual(entry());
    expect(kept.note()).toEqual({ key: 'notSaved' });
  });

  // @traces 208-FR-010
  it('tells a change once something differs from the copy as opened', () => {
    const kept = keeper();
    kept.adoptCopy(COPY);
    expect(kept.changedSince()).toBe(false);

    kept.section('1', { name: 'Service Popescu Nou' });

    expect(kept.changedSince()).toBe(true);
  });

  // @traces 208-FR-010
  it('counts a save made in an earlier session as a change', () => {
    const kept = keeper();

    kept.adoptCopy({ ...COPY, edited: true });

    expect(kept.changedSince()).toBe(true);
  });

  // @traces 208-FR-008
  it('tells a file no longer asking for more apart, without ending the form', async () => {
    const kept = keeper();
    kept.adoptCopy(COPY);
    api['listingSubmitControllerSubmit'].mockRejectedValue(
      new HttpErrorResponse({
        error: {
          code: 'verification_transition_refused',
          currentStatus: 'approved',
        },
        status: 409,
      }),
    );

    expect(await kept.submit('k-1')).toEqual({ kind: 'refused' });
    expect(kept.view()).toBe('form');
  });
});
