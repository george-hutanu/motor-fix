import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ApprovalGap } from '@motor-fix/contracts/verification-target';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { VerificationApprove } from './verification-approve';

// @traces 303-FR-002 303-FR-011 303-FR-012

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

let result: Promise<OverlayResult<{ note?: string }>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(missing: ApprovalGap[] = [], language: 'ro' | 'en' = 'ro') {
  TestBed.configureTestingModule({});
  const i18n = TestBed.inject(I18n);
  if (language === 'en') await i18n.use('en');
  await i18n.enter('admin');
  await i18n.enter('public');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open(VerificationApprove, {
    data: { missing },
    shape: 'dialog',
    title: 'admin.file.approve.title',
  });
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
const cancel = () =>
  [...panel().querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.type === 'button' && /Renunță|Cancel/.test(b.textContent ?? ''),
  ) as HTMLButtonElement;
const text = (el: Element | null = panel()) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const lines = () =>
  [...panel().querySelectorAll('[data-part="missing"] li')].map((li) =>
    text(li),
  );

function type(value: string) {
  note().value = value;
  note().dispatchEvent(new Event('input', { bubbles: true }));
}

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
});

describe('approving with every check ok', () => {
  it('says so, and the note is optional', async () => {
    await open();

    expect(text()).toContain('Toate verificările sunt în regulă.');
    expect(lines()).toEqual([]);
    expect(note().required).toBe(false);
    expect(note().hasAttribute('maxlength')).toBe(false);
    expect(text()).toContain('Notă');
  });

  it('reads in English', async () => {
    await open([], 'en');

    expect(text()).toContain('Every check is ok.');
    expect(text(confirm())).toBe('Approve and publish');
    expect(text(cancel())).toBe('Cancel');
  });

  it('closes with no note when none is written', async () => {
    await open();

    confirm().click();
    await settle();

    await expect(result).resolves.toEqual({});
  });

  it('closes with the note trimmed', async () => {
    await open();

    type('  Totul verificat la telefon  ');
    await settle();
    confirm().click();
    await settle();

    await expect(result).resolves.toEqual({
      note: 'Totul verificat la telefon',
    });
  });

  it('counts what is written, as the server counts it', async () => {
    await open();
    expect(text()).toContain('0/1000');

    type('Ok 🚗');
    await settle();

    expect(text()).toContain('4/1000');
  });

  it('moves focus into the dialog on open', async () => {
    await open();

    const dialog = panel().closest('[role="dialog"]') as HTMLElement;
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('closes as cancelled on "Renunță", sending nothing', async () => {
    await open();

    cancel().click();
    await settle();

    await expect(result).resolves.toBe('cancelled');
  });

  it('closes as cancelled on Escape', async () => {
    await open();

    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await settle();

    await expect(result).resolves.toBe('cancelled');
  });
});

describe('approving past what is not ok', () => {
  it.each([
    ['not_run', 'neverificat'],
    ['warning', 'atenție'],
    ['failed', 'problemă'],
  ] as const)('names a %s check with its result', async (result, word) => {
    await open([{ kind: 'photos', result }]);

    expect(lines()).toEqual([`Fotografii: ${word}`]);
    expect(text()).not.toContain('Toate verificările sunt în regulă.');
  });

  it.each([
    ['not_run', 'not checked'],
    ['warning', 'warning'],
    ['failed', 'failure'],
  ] as const)('names a %s check in English', async (result, word) => {
    await open([{ kind: 'representative', result }], 'en');

    expect(lines()).toEqual([`Phone: ${word}`]);
  });

  it('names each missing document, after the checks', async () => {
    await open([
      { kind: 'company', result: 'failed' },
      { document: 'onrc_certificate' },
      { document: 'rar_authorisation' },
    ]);

    expect(lines()).toEqual([
      'Firmă: problemă',
      'Lipsește: Certificat constatator ONRC',
      'Lipsește: Autorizația tehnică RAR',
    ]);
  });

  it('names a missing document in English', async () => {
    await open([{ document: 'onrc_certificate' }], 'en');

    expect(lines()).toEqual(['Missing: ONRC company certificate']);
  });

  it.each(['', '   '])(
    'refuses %j as the note, naming the field, and stays open',
    async (value) => {
      await open([{ kind: 'address', result: 'warning' }]);
      expect(note().required).toBe(true);

      type(value);
      await settle();
      confirm().click();
      await settle();

      const error = panel().querySelector('[role="alert"]');
      expect(text(error)).toBe('Scrie de ce aprobi așa.');
      expect(note().getAttribute('aria-invalid')).toBe('true');
      expect(note().getAttribute('aria-describedby')).toContain(error?.id);
      expect(panel().isConnected).toBe(true);
    },
  );

  it('says it in English', async () => {
    await open([{ kind: 'address', result: 'warning' }], 'en');

    confirm().click();
    await settle();

    expect(text(panel().querySelector('[role="alert"]'))).toBe(
      'Say why you approve as it is.',
    );
  });

  it('closes with the note once one is written', async () => {
    await open([{ document: 'rar_authorisation' }]);
    confirm().click();
    await settle();

    type('Autorizația vine mâine pe e‑mail');
    await settle();
    confirm().click();
    await settle();

    await expect(result).resolves.toEqual({
      note: 'Autorizația vine mâine pe e‑mail',
    });
  });
});
