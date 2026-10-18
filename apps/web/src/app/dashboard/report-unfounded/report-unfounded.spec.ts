import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { ReportUnfounded } from './report-unfounded';

// @traces 069-report-decision-FR-009 069-report-decision-FR-010

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

async function open(language: 'ro' | 'en' = 'ro') {
  TestBed.configureTestingModule({});
  const i18n = TestBed.inject(I18n);
  if (language === 'en') await i18n.use('en');
  await i18n.enter('admin');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open(ReportUnfounded, {
    shape: 'dialog',
    title: 'admin.file.reportDecision.unfounded',
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

function type(value: string) {
  note().value = value;
  note().dispatchEvent(new Event('input', { bubbles: true }));
}

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
});

// The first open loads the translations and the overlay's panel, which on a
// busy machine can outlast a test's 5 s: it is paid once here instead.
beforeAll(async () => {
  await open('en');
  TestBed.resetTestingModule();
  await open();
  TestBed.resetTestingModule();
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
}, 30_000);

describe('closing the reports as unfounded', () => {
  it('asks with one optional, labelled internal note', async () => {
    await open();

    expect(text()).toContain('Notă internă');
    expect(note().required).toBe(false);
    expect(note().labels?.[0]?.textContent?.trim()).toBe('Notă internă');
    expect(text(confirm())).toBe('Sesizare nefondată');
    expect(text(cancel())).toBe('Renunță');
  });

  it('reads in English', async () => {
    await open('en');

    expect(text()).toContain('Internal note');
    expect(text(confirm())).toBe('Report unfounded');
    expect(text(cancel())).toBe('Cancel');
  });

  it('closes with no note when none is written', async () => {
    await open();

    confirm().click();
    await settle();

    await expect(result).resolves.toEqual({});
  });

  it('closes with the note trimmed, a blank one left out', async () => {
    await open();

    type('  Am sunat, adresa e corectă  ');
    await settle();
    confirm().click();
    await settle();

    await expect(result).resolves.toEqual({
      note: 'Am sunat, adresa e corectă',
    });
  });

  it('counts the note as the server does, an emoji as one', async () => {
    await open();
    expect(text()).toContain('0/1000');

    type('Ok 🚗');
    await settle();

    expect(text()).toContain('4/1000');
  });

  it('refuses a note past 1,000 characters, names it, and stays open', async () => {
    await open();
    let settled = false;
    void result.then(() => {
      settled = true;
    });

    type('a'.repeat(1001));
    await settle();
    confirm().click();
    await settle();

    expect(settled).toBe(false);
    expect(text(panel().querySelector('[role="alert"]'))).toBe(
      'Nota are cel mult 1000 de caractere.',
    );
    expect(note().getAttribute('aria-invalid')).toBe('true');

    type('a'.repeat(1000));
    await settle();
    expect(panel().querySelector('[role="alert"]')).toBeNull();
    confirm().click();
    await settle();

    await expect(result).resolves.toEqual({ note: 'a'.repeat(1000) });
  });

  it('closes as cancelled on "Renunță", sending nothing', async () => {
    await open();

    cancel().click();
    await settle();

    await expect(result).resolves.toBe('cancelled');
  });

  it('moves focus into the dialog on open', async () => {
    await open();

    const dialog = panel().closest('[role="dialog"]') as HTMLElement;
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});
