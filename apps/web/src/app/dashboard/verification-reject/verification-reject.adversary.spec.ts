import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import {
  VerificationReject,
  type VerificationRejectData,
  type VerificationRejection,
} from './verification-reject';

// @traces 305-FR-002 305-FR-010

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

let result: Promise<OverlayResult<VerificationRejection>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(
  data: VerificationRejectData = {},
  language: 'ro' | 'en' = 'ro',
) {
  TestBed.configureTestingModule({});
  const i18n = TestBed.inject(I18n);
  if (language === 'en') await i18n.use('en');
  await i18n.enter('admin');
  await i18n.enter('public');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open(VerificationReject, {
    data,
    shape: 'dialog',
    title: 'admin.file.reject.title',
  });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const radios = () => [
  ...panel().querySelectorAll<HTMLInputElement>('input[type="radio"]'),
];
const radio = (code: string) =>
  panel().querySelector<HTMLInputElement>(
    `input[type="radio"][value="${code}"]`,
  ) as HTMLInputElement;
const group = () => panel().querySelector('fieldset') as HTMLFieldSetElement;
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
const alerts = () =>
  [...panel().querySelectorAll('[role="alert"]')].map((a) => text(a));

function type(value: string) {
  note().value = value;
  note().dispatchEvent(new Event('input', { bubbles: true }));
}

function pick(code: string) {
  radio(code).click();
}

async function send() {
  confirm().click();
  await settle();
}

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
});

describe('the rejection dialog, attacked', () => {
  it('counts a note of combining marks and emoji by code points', async () => {
    await open();

    type('e\u0301🚗');
    await settle();

    expect(text()).toContain('3/1000');
  });

  it('refuses a note of no-break spaces and tabs as blank', async () => {
    await open();
    pick('rar');
    type('\u00a0\t\u00a0\n   ');
    await settle();

    await send();

    expect(alerts()).toEqual(['Scrie un mesaj pentru service.']);
  });

  it('judges the trimmed note: ten characters with padding around nine is too short', async () => {
    await open();
    pick('rar');
    type('  abcdefghi  ');
    await settle();

    await send();

    expect(alerts()).toEqual(['Mesajul are cel puțin 10 caractere.']);
    expect(document.activeElement).toBe(note());
  });

  it('accepts a note of 1,000 code points padded to more with spaces', async () => {
    await open();
    pick('rar');
    type(`  ${'a'.repeat(1000)}  `);
    await settle();

    await send();

    await expect(result).resolves.toEqual({
      note: 'a'.repeat(1000),
      reason: 'rar',
    });
  });

  it('keeps markup in the note as written and renders none', async () => {
    await open();
    pick('other');
    type('<img src=x onerror=alert(1)> plus');
    await settle();

    expect(panel().querySelector('img')).toBeNull();
    await send();

    await expect(result).resolves.toEqual({
      note: '<img src=x onerror=alert(1)> plus',
      reason: 'other',
    });
  });

  it('sends the last reason when the admin changes their mind', async () => {
    await open();
    pick('rar');
    pick('photos');
    type('Fotografiile sunt neclare.');
    await settle();

    await send();

    await expect(result).resolves.toEqual({
      note: 'Fotografiile sunt neclare.',
      reason: 'photos',
    });
  });

  it('clears the reason message once a reason is picked', async () => {
    await open();
    type('Autorizația RAR a expirat.');
    await settle();
    await send();
    expect(alerts()).toEqual(['Alege un motiv.']);

    pick('address');
    await settle();

    expect(alerts()).toEqual([]);
    expect(group().hasAttribute('aria-invalid')).toBe(false);
  });

  it('closes once when confirm is pressed twice', async () => {
    await open();
    pick('rar');
    type('Autorizația RAR a expirat.');
    await settle();

    confirm().click();
    confirm().click();
    await settle();

    await expect(result).resolves.toEqual({
      note: 'Autorizația RAR a expirat.',
      reason: 'rar',
    });
  });

  it.each([
    ['reasonRequired', 'Alege un motiv.', 'group'],
    ['noteRequired', 'Scrie un mesaj pentru service.', 'note'],
    ['noteTooLong', 'Mesajul are cel mult 1000 de caractere.', 'note'],
  ] as const)(
    'opens marked for %s, naming the field and focusing it',
    async (refused, message, field) => {
      await open({ note: 'Prea scurt', reason: 'rar', refused });

      expect(alerts()).toEqual([message]);
      const target = field === 'group' ? group() : note();
      expect(target.getAttribute('aria-invalid')).toBe('true');
      expect(target.contains(document.activeElement)).toBe(true);
    },
  );

  it('opens with a reason the admin had not chosen: none selected, nothing marked', async () => {
    await open({ note: 'Autorizația RAR a expirat.' });

    expect(radios().every((r) => !r.checked)).toBe(true);
    expect(alerts()).toEqual([]);
    expect(note().value).toBe('Autorizația RAR a expirat.');
  });

  it('opens with an unknown reason code selecting no option', async () => {
    await open({ reason: 'bogus' as never });

    expect(radios().every((r) => !r.checked)).toBe(true);
  });

  it('refuses a confirm after the note is cleared following a valid one', async () => {
    await open();
    pick('rar');
    type('Autorizația RAR a expirat.');
    await settle();
    type('');
    await settle();

    await send();

    expect(alerts()).toEqual(['Scrie un mesaj pentru service.']);
  });

  it('shows no refusal on open when none was given', async () => {
    await open();

    expect(alerts()).toEqual([]);
    expect(text(cancel())).toBe('Renunță');
  });
});
