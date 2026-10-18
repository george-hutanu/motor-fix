import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { ReportDecision, type ReportDecisionData } from './report-decision';

// @traces 069-FR-009 069-FR-010

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
const cancel = () =>
  [...panel().querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.type === 'button' && /Renunță|Cancel/.test(b.textContent ?? ''),
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

describe('closing the reports as unfounded', () => {
  it('asks with one optional, labelled internal note', async () => {
    await open('unfounded');

    expect(text()).toContain('Notă internă');
    expect(field().required).toBe(false);
    expect(field().labels?.[0]?.textContent?.trim()).toBe('Notă internă');
    expect(text(confirm())).toBe('Sesizare nefondată');
    expect(text(cancel())).toBe('Renunță');
  });

  it('reads in English', async () => {
    await open('unfounded', 'en');

    expect(text()).toContain('Internal note');
    expect(text(confirm())).toBe('Report unfounded');
    expect(text(cancel())).toBe('Cancel');
  });

  it('closes with no note when none is written', async () => {
    await open('unfounded');

    confirm().click();
    await settle();

    await expect(result).resolves.toEqual({});
  });

  it('closes with the note trimmed, a blank one left out', async () => {
    await open('unfounded');

    type('  Am sunat, adresa e corectă  ');
    await settle();
    confirm().click();
    await settle();

    await expect(result).resolves.toEqual({
      note: 'Am sunat, adresa e corectă',
    });
  });

  it('counts the note as the server does, an emoji as one', async () => {
    await open('unfounded');
    expect(text()).toContain('0/1000');

    type('Ok 🚗');
    await settle();

    expect(text()).toContain('4/1000');
  });

  it('refuses a note past 1,000 characters, names it, and stays open', async () => {
    await open('unfounded');
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
    expect(field().getAttribute('aria-invalid')).toBe('true');

    type('a'.repeat(1000));
    await settle();
    expect(panel().querySelector('[role="alert"]')).toBeNull();
    confirm().click();
    await settle();

    await expect(result).resolves.toEqual({ note: 'a'.repeat(1000) });
  });

  it('closes as cancelled on "Renunță", sending nothing', async () => {
    await open('unfounded');

    cancel().click();
    await settle();

    await expect(result).resolves.toBe('cancelled');
  });

  it('moves focus into the dialog on open', async () => {
    await open('unfounded');

    const dialog = panel().closest('[role="dialog"]') as HTMLElement;
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});

describe('confirming the reports', () => {
  it('asks for the required reason the garage will see, and says the garage is suspended', async () => {
    await open('confirmed');

    expect(field().required).toBe(true);
    expect(field().labels?.[0]?.textContent?.trim()).toBe(
      'Motivul pe care îl vede service‑ul',
    );
    expect(text()).toContain(
      'Service‑ul va fi suspendat și va primi acest motiv.',
    );
    expect(text(confirm())).toBe('Confirmă și suspendă');
    expect(text(cancel())).toBe('Renunță');
  });

  it('reads in English', async () => {
    await open('confirmed', 'en');

    expect(field().labels?.[0]?.textContent?.trim()).toBe(
      'The reason the garage will see',
    );
    expect(text()).toContain(
      'The garage will be suspended and receive this reason.',
    );
    expect(text(confirm())).toBe('Confirm and suspend');
    expect(text(cancel())).toBe('Cancel');
  });

  it.each(['', '   '])(
    'keeps the confirm disabled while the reason is %j',
    async (value) => {
      await open('confirmed');

      type(value);
      await settle();

      expect(confirm().disabled).toBe(true);
    },
  );

  it('closes with the reason trimmed', async () => {
    await open('confirmed');

    type('  Prețuri false confirmate la telefon  ');
    await settle();
    expect(confirm().disabled).toBe(false);
    confirm().click();
    await settle();

    await expect(result).resolves.toEqual({
      reason: 'Prețuri false confirmate la telefon',
    });
  });

  it('counts the reason as the server does, up to 200', async () => {
    await open('confirmed');
    expect(text()).toContain('0/200');

    type('Fals 🚗');
    await settle();

    expect(text()).toContain('6/200');
  });

  it('refuses a reason past 200 characters, names it, and stays open', async () => {
    await open('confirmed');
    let settled = false;
    void result.then(() => {
      settled = true;
    });

    type('a'.repeat(201));
    await settle();
    confirm().click();
    await settle();

    expect(settled).toBe(false);
    expect(text(panel().querySelector('[role="alert"]'))).toBe(
      'Motivul are cel mult 200 de caractere.',
    );
    expect(field().getAttribute('aria-invalid')).toBe('true');

    type('a'.repeat(200));
    await settle();
    expect(panel().querySelector('[role="alert"]')).toBeNull();
    confirm().click();
    await settle();

    await expect(result).resolves.toEqual({ reason: 'a'.repeat(200) });
  });

  it('closes as cancelled on "Renunță", suspending nothing', async () => {
    await open('confirmed');

    cancel().click();
    await settle();

    await expect(result).resolves.toBe('cancelled');
  });
});
