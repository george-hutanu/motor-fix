import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ApprovalGap } from '@motor-fix/contracts/verification-target';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { VerificationApprove } from './verification-approve';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

let result: Promise<OverlayResult<{ note?: string }>>;
let closed: unknown[];

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(missing: ApprovalGap[] = []) {
  TestBed.configureTestingModule({});
  const i18n = TestBed.inject(I18n);
  await i18n.enter('admin');
  await i18n.enter('public');
  const host = TestBed.createComponent(Host);
  const mine: unknown[] = [];
  closed = mine;
  result = host.componentInstance.overlays.open(VerificationApprove, {
    data: { missing },
    shape: 'dialog',
    title: 'admin.file.approve.title',
  });
  void result.then((value) => mine.push(value));
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const note = () =>
  panel().querySelector<HTMLTextAreaElement>('textarea') as HTMLTextAreaElement;
const confirm = () =>
  panel().querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  ) as HTMLButtonElement;
const text = (el: Element | null = panel()) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

function type(value: string) {
  note().value = value;
  note().dispatchEvent(new Event('input', { bubbles: true }));
}

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
});

const REQUIRED: ApprovalGap[] = [{ kind: 'photos', result: 'warning' }];

describe('the approval dialog, attacked', () => {
  // @traces 303-FR-002
  it.each(['  ', ' ', '\n\n\t', ' \r\n '])(
    'refuses a required note of only blank characters %j',
    async (blank) => {
      await open(REQUIRED);

      type(blank);
      await settle();
      confirm().click();
      await settle();

      expect(text(panel().querySelector('[role="alert"]'))).toBe(
        'Scrie de ce aprobi așa.',
      );
      expect(closed).toEqual([]);
    },
  );

  // @traces 303-FR-002
  it('clears the refusal once a real note is typed and keeps it while blank', async () => {
    await open(REQUIRED);
    confirm().click();
    await settle();
    expect(panel().querySelector('[role="alert"]')).not.toBeNull();

    type('   ');
    await settle();
    expect(panel().querySelector('[role="alert"]')).not.toBeNull();

    type('Motiv');
    await settle();
    expect(panel().querySelector('[role="alert"]')).toBeNull();
    expect(note().getAttribute('aria-invalid')).toBeNull();
  });

  // @traces 303-FR-002
  it('closes with exactly 1,000 code points of emoji', async () => {
    await open(REQUIRED);
    const full = '🚗'.repeat(1000);

    type(full);
    await settle();
    expect(text()).toContain('1000/1000');
    confirm().click();
    await settle();

    await expect(result).resolves.toEqual({ note: full });
  });

  // @traces 303-FR-002
  it('does not send a note of 1,001 code points', async () => {
    await open([]);

    type('a'.repeat(1001));
    await settle();
    confirm().click();
    await settle();

    expect(closed).toEqual([]);
  });

  // @traces 303-FR-002
  it('counts a note of 1,001 characters as 1001 so the admin sees the overshoot', async () => {
    await open([]);

    type('a'.repeat(1001));
    await settle();

    expect(text()).toContain('1001/1000');
  });

  // @traces 303-FR-002
  it('resolves once with the note when confirm is pressed twice', async () => {
    await open(REQUIRED);
    type('Verificat');
    await settle();

    confirm().click();
    confirm().click();
    await settle();

    expect(closed).toEqual([{ note: 'Verificat' }]);
  });

  // @traces 303-FR-002
  it('keeps hostile markup in the note as plain text in the count and sends it unchanged', async () => {
    await open([]);
    const hostile = '<img src=x onerror=alert(1)>';

    type(hostile);
    await settle();
    confirm().click();
    await settle();

    await expect(result).resolves.toEqual({ note: hostile });
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });

  // @traces 303-FR-002
  it('lists an unknown gap shape without breaking the other lines', async () => {
    await open([
      { kind: 'photos', result: 'failed' },
      { kind: 'photos', result: 'failed' },
    ]);

    expect(panel().querySelectorAll('[data-part="missing"] li')).toHaveLength(
      2,
    );
  });

  // @traces 303-FR-002
  it('keeps a multi-line note with its inner line breaks, trimming only the ends', async () => {
    await open(REQUIRED);

    type('\n linia 1\n\nlinia 2 \n');
    await settle();
    confirm().click();
    await settle();

    await expect(result).resolves.toEqual({ note: 'linia 1\n\nlinia 2' });
  });

  // @traces 303-FR-002
  it('sends no note key at all when an optional note is blank', async () => {
    await open([]);

    type('  \n ');
    await settle();
    confirm().click();
    await settle();

    const value = (await result) as Record<string, unknown>;
    expect(Object.keys(value)).toEqual([]);
  });
});
