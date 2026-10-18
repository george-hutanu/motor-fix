import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { ReportConfirmed } from './report-confirmed';

// @traces 069-report-decision-FR-009 069-report-decision-FR-010

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

let result: Promise<OverlayResult<{ reason: string }>>;

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
  result = host.componentInstance.overlays.open(ReportConfirmed, {
    shape: 'dialog',
    title: 'admin.file.reportDecision.confirmed',
  });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const reason = () =>
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
  reason().value = value;
  reason().dispatchEvent(new Event('input', { bubbles: true }));
}

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
});

describe('confirming the reports', () => {
  it('asks for the required reason the garage will see, and says the garage is suspended', async () => {
    await open();

    expect(reason().required).toBe(true);
    expect(reason().labels?.[0]?.textContent?.trim()).toBe(
      'Motivul pe care îl vede service‑ul',
    );
    expect(text()).toContain(
      'Service‑ul va fi suspendat și va primi acest motiv.',
    );
    expect(text(confirm())).toBe('Confirmă și suspendă');
    expect(text(cancel())).toBe('Renunță');
  });

  it('reads in English', async () => {
    await open('en');

    expect(reason().labels?.[0]?.textContent?.trim()).toBe(
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
      await open();

      type(value);
      await settle();

      expect(confirm().disabled).toBe(true);
    },
  );

  it('closes with the reason trimmed', async () => {
    await open();

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
    await open();
    expect(text()).toContain('0/200');

    type('Fals 🚗');
    await settle();

    expect(text()).toContain('6/200');
  });

  it('refuses a reason past 200 characters, names it, and stays open', async () => {
    await open();
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
    expect(reason().getAttribute('aria-invalid')).toBe('true');

    type('a'.repeat(200));
    await settle();
    expect(panel().querySelector('[role="alert"]')).toBeNull();
    confirm().click();
    await settle();

    await expect(result).resolves.toEqual({ reason: 'a'.repeat(200) });
  });

  it('closes as cancelled on "Renunță", suspending nothing', async () => {
    await open();

    cancel().click();
    await settle();

    await expect(result).resolves.toBe('cancelled');
  });
});
