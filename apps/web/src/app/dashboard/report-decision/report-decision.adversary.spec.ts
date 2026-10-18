import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { ReportDecision, type ReportDecisionData } from './report-decision';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

let result: Promise<OverlayResult<{ note?: string } | { reason: string }>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(
  decision: ReportDecisionData['decision'],
  language: 'ro' | 'en' = 'ro',
) {
  TestBed.configureTestingModule({});
  const i18n = TestBed.inject(I18n);
  if (language === 'en') await i18n.use('en');
  await i18n.enter('admin');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open(ReportDecision, {
    data: { decision },
    shape: 'dialog',
    title: `admin.file.reportDecision.${decision}`,
  });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const field = () =>
  panel().querySelector<HTMLTextAreaElement>('textarea') as HTMLTextAreaElement;
const confirm = () =>
  panel().querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  ) as HTMLButtonElement;
const text = (el: Element | null = panel()) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

function type(value: string) {
  field().value = value;
  field().dispatchEvent(new Event('input', { bubbles: true }));
}

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
});

// The first open loads the translations and the overlay's panel, which on a
// busy machine can outlast a test's 5 s: it is paid once here instead.
beforeAll(async () => {
  await open('unfounded', 'en');
  TestBed.resetTestingModule();
  await open('confirmed');
  TestBed.resetTestingModule();
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
}, 30_000);

describe('closing the reports as unfounded under hostile input', () => {
  // @traces 069-FR-009
  it('accepts exactly 1000 emoji and refuses 1001, counting code points', async () => {
    await open('unfounded');

    type('🚗'.repeat(1000));
    await settle();
    expect(text()).toContain('1000/1000');
    expect(panel().querySelector('[role="alert"]')).toBeNull();

    type('🚗'.repeat(1001));
    await settle();
    confirm().click();
    await settle();

    expect(text(panel().querySelector('[role="alert"]'))).toBe(
      'Nota are cel mult 1000 de caractere.',
    );
  });

  // @traces 069-FR-009
  it('sends a note of 1000 characters padded with spaces', async () => {
    await open('unfounded');

    type(`  ${'n'.repeat(1000)}  `);
    await settle();
    confirm().click();
    await settle();

    await expect(result).resolves.toEqual({ note: 'n'.repeat(1000) });
  });

  // @traces 069-FR-009
  it('leaves a whitespace-only note out', async () => {
    await open('unfounded');

    type(' \n\t ');
    await settle();
    confirm().click();
    await settle();

    await expect(result).resolves.toEqual({});
  });

  // @traces 069-FR-009
  it('keeps line breaks inside a note', async () => {
    await open('unfounded');

    type('a\nb');
    await settle();
    confirm().click();
    await settle();

    await expect(result).resolves.toEqual({ note: 'a\nb' });
  });

  // @traces 069-FR-009
  it('returns markup as plain text, not as elements', async () => {
    await open('unfounded');

    type('<script>alert(1)</script>');
    await settle();
    confirm().click();
    await settle();

    await expect(result).resolves.toEqual({
      note: '<script>alert(1)</script>',
    });
  });

  // @traces 069-FR-009
  it('closes once when the confirm is pressed twice', async () => {
    await open('unfounded');
    const seen: unknown[] = [];
    void result.then((value) => seen.push(value));

    confirm().click();
    confirm().click();
    await settle();

    expect(seen).toEqual([{}]);
  });

  // @traces 069-FR-009
  it('clears the limit message once the note is short enough again', async () => {
    await open('unfounded');

    type('a'.repeat(1001));
    await settle();
    confirm().click();
    await settle();
    type('a'.repeat(1000));
    await settle();

    expect(panel().querySelector('[role="alert"]')).toBeNull();
    expect(field().getAttribute('aria-invalid')).toBeNull();
  });
});

describe('confirming the reports under hostile input', () => {
  // @traces 069-FR-009
  it('accepts exactly 200 emoji and refuses 201, counting code points', async () => {
    await open('confirmed');

    type('🚗'.repeat(200));
    await settle();
    expect(text()).toContain('200/200');
    expect(panel().querySelector('[role="alert"]')).toBeNull();

    type('🚗'.repeat(201));
    await settle();
    confirm().click();
    await settle();

    expect(text(panel().querySelector('[role="alert"]'))).toBe(
      'Motivul are cel mult 200 de caractere.',
    );
  });

  // @traces 069-FR-009
  it('measures the limit after trimming, so padding around 200 characters still sends', async () => {
    await open('confirmed');

    type(`   ${'a'.repeat(200)}   `);
    await settle();
    confirm().click();
    await settle();

    await expect(result).resolves.toEqual({ reason: 'a'.repeat(200) });
  });

  // @traces 069-FR-009
  it('returns markup as plain text, not as elements', async () => {
    await open('confirmed');

    type('<img src=x onerror=alert(1)>');
    await settle();
    confirm().click();
    await settle();

    await expect(result).resolves.toEqual({
      reason: '<img src=x onerror=alert(1)>',
    });
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });

  // @traces 069-FR-009
  it('does not close when the form is submitted with a blank reason from the keyboard', async () => {
    await open('confirmed');
    let settled = false;
    void result.then(() => {
      settled = true;
    });

    type('   ');
    await settle();
    panel()
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();

    expect(settled).toBe(false);
  });

  // @traces 069-FR-009
  it('closes once when the confirm is pressed twice', async () => {
    await open('confirmed');
    const seen: unknown[] = [];
    void result.then((value) => seen.push(value));

    type('Motiv');
    await settle();
    confirm().click();
    confirm().click();
    await settle();

    expect(seen).toEqual([{ reason: 'Motiv' }]);
  });
});
