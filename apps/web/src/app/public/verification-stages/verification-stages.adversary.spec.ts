import { TestBed } from '@angular/core/testing';
import {
  VERIFICATION_REASON_CODES,
  type VerificationStageStatus,
} from '@motor-fix/contracts';
import { I18n } from '@motor-fix/i18n';

import { VerificationStages } from './verification-stages';

async function render(
  inputs: {
    status: VerificationStageStatus;
    requestedItems?: string[];
    reason?: { code: string; note: string } | null;
  },
  language: 'ro' | 'en' = 'ro',
) {
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(VerificationStages);
  for (const [key, value] of Object.entries(inputs))
    fixture.componentRef.setInput(key, value);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

afterEach(() => TestBed.resetTestingModule());

// @traces 116-FR-015
describe('the verification stages with hostile input', () => {
  it.each(['ro', 'en'] as const)(
    'has a %s text for every code a request for more or a rejection can carry',
    async (language) => {
      const host = await render(
        {
          requestedItems: [...VERIFICATION_REASON_CODES],
          status: 'more_requested',
        },
        language,
      );

      const items = [...host.querySelectorAll('.items li')].map((li) =>
        text(li),
      );
      expect(items).toHaveLength(VERIFICATION_REASON_CODES.length);
      for (const item of items)
        expect(item).not.toContain('verificationStatus');
    },
  );

  it('shows no raw translation key for a reason code the five do not name', async () => {
    const host = await render({
      reason: { code: 'legacy_reason', note: 'Nota veche, cel puțin zece.' },
      status: 'rejected',
    });

    expect(text(host)).not.toContain('verificationStatus');
    expect(text(host.querySelector('.note'))).toBe(
      'Nota veche, cel puțin zece.',
    );
  });

  it('shows no raw translation key for an empty reason code with an empty note', async () => {
    const host = await render({
      reason: { code: '', note: '' },
      status: 'rejected',
    });

    expect(text(host)).not.toContain('verificationStatus');
  });

  it('shows no raw translation key for a requested item the client does not know', async () => {
    const host = await render({
      requestedItems: ['documents', 'brand_new_item'],
      status: 'more_requested',
    });

    expect(text(host)).not.toContain('verificationStatus');
    expect(text(host)).not.toContain('brand_new_item');
  });

  it('shows a note with markup as plain text', async () => {
    const note = '<img src=x onerror=alert(1)> și <b>mai mult</b>';

    const host = await render({
      reason: { code: 'documents', note },
      status: 'rejected',
    });

    expect(host.querySelector('.note img')).toBeNull();
    expect(host.querySelector('.note b')).toBeNull();
    expect(text(host.querySelector('.note'))).toBe(note);
  });

  it.each([
    'draft',
    'submitted',
    'in_review',
    'approved',
    'rejected',
  ] as VerificationStageStatus[])(
    'lists no requested items left over from an earlier status under %s',
    async (status) => {
      const host = await render({ requestedItems: ['photos'], status });

      expect(host.querySelector('ul.items')).toBeNull();
    },
  );

  it.each([
    'draft',
    'submitted',
    'in_review',
    'approved',
    'more_requested',
  ] as VerificationStageStatus[])(
    'shows no rejection left over from an earlier status under %s',
    async (status) => {
      const host = await render({
        reason: { code: 'other', note: 'old note' },
        status,
      });

      expect(host.querySelector('.note')).toBeNull();
      expect(host.querySelector('.reason')).toBeNull();
    },
  );

  it('lights nothing for a status the contract does not name', async () => {
    const host = await render({ status: 'suspended' as never });

    expect(
      [...host.querySelectorAll('ol.stages > li')].map((li) =>
        li.classList.contains('lit'),
      ),
    ).toEqual([false, false, false]);
    expect(host.querySelector('[aria-current]')).toBeNull();
  });

  it('lights nothing and marks no stage current for a garage with no file, and has no button', async () => {
    const host = await render({ status: 'draft' });

    expect(host.querySelectorAll('ol.stages > li.lit')).toHaveLength(0);
    expect(host.querySelector('[aria-current]')).toBeNull();
    expect(host.querySelector('button')).toBeNull();
    expect(host.querySelector('.off-map')).not.toBeNull();
  });

  it('marks exactly one stage current for every status but draft, and no off-map line for approved', async () => {
    for (const status of [
      'submitted',
      'in_review',
      'more_requested',
      'rejected',
      'approved',
    ] as const) {
      const host = await render({ status });
      expect(host.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
      expect(host.querySelector('.off-map') === null).toBe(
        status === 'approved',
      );
      TestBed.resetTestingModule();
    }
  });

  it('lists a thousand requested items without dropping one', async () => {
    const host = await render({
      requestedItems: Array.from({ length: 1000 }, () => 'other'),
      status: 'more_requested',
    });

    expect(host.querySelectorAll('.items li')).toHaveLength(1000);
  });
});
