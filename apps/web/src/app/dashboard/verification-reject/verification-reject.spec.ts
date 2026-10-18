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

describe('the rejection dialog', () => {
  it('offers the five reasons, one per radio, none chosen, and both fields required', async () => {
    await open();

    expect(radios().map((r) => r.value)).toEqual([
      'documents',
      'rar',
      'address',
      'photos',
      'other',
    ]);
    expect(radios().map((r) => r.checked)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(radios().map((r) => text(r.closest('label')))).toEqual([
      'Documente',
      'Autorizația RAR',
      'Adresa',
      'Fotografiile',
      'Altceva',
    ]);
    expect(text(group().querySelector('legend'))).toContain('Motivul');
    expect(radios().every((r) => r.required)).toBe(true);
    expect(note().required).toBe(true);
    expect(note().hasAttribute('maxlength')).toBe(false);
    expect(text()).toContain('Mesaj pentru service');
    expect(text()).toContain('Service‑ul primește mesajul cuvânt cu cuvânt.');
    expect(text(confirm())).toBe('Respinge');
  });

  it('reads in English', async () => {
    await open({}, 'en');

    expect(radios().map((r) => text(r.closest('label')))).toEqual([
      'Documents',
      'The RAR authorisation',
      'The address',
      'The photos',
      'Something else',
    ]);
    expect(text()).toContain('Message to the garage');
    expect(text(confirm())).toBe('Reject');
    expect(text(cancel())).toBe('Cancel');
  });

  it('counts what is written in code points', async () => {
    await open();
    expect(text()).toContain('0/1000');

    type('Ok 🚗');
    await settle();

    expect(text()).toContain('4/1000');
  });

  it('moves focus to the reasons on open', async () => {
    await open();

    expect(group().contains(document.activeElement)).toBe(true);
  });

  it('refuses a confirm with no reason, marking the reasons and focusing them', async () => {
    await open();
    type('Autorizația RAR a expirat.');
    await settle();

    await send();

    expect(alerts()).toEqual(['Alege un motiv.']);
    expect(group().getAttribute('aria-invalid')).toBe('true');
    expect(group().getAttribute('aria-describedby')).toContain(
      panel().querySelector('[role="alert"]')?.id,
    );
    expect(group().contains(document.activeElement)).toBe(true);
    expect(panel().isConnected).toBe(true);
  });

  it.each([
    ['an empty note', '', 'Scrie un mesaj pentru service.'],
    ['a note of spaces', '    ', 'Scrie un mesaj pentru service.'],
    ['nine letters', 'Abcdefghi', 'Mesajul are cel puțin 10 caractere.'],
    [
      'nine code points, one an emoji',
      '🚗bcdefghi',
      'Mesajul are cel puțin 10 caractere.',
    ],
    [
      '1,001 code points',
      'a'.repeat(1001),
      'Mesajul are cel mult 1000 de caractere.',
    ],
  ])(
    'refuses %s, naming the note and focusing it',
    async (_name, value, message) => {
      await open();
      pick('rar');
      type(value);
      await settle();

      await send();

      expect(alerts()).toEqual([message]);
      expect(note().getAttribute('aria-invalid')).toBe('true');
      expect(note().getAttribute('aria-describedby')).toContain(
        panel().querySelector('[role="alert"]')?.id,
      );
      expect(document.activeElement).toBe(note());
    },
  );

  it('names the reason first when both fields fail', async () => {
    await open();

    await send();

    expect(alerts()).toEqual(['Alege un motiv.']);
  });

  it('says the refusals in English', async () => {
    await open({}, 'en');
    await send();
    expect(alerts()).toEqual(['Pick a reason.']);

    pick('other');
    await send();
    expect(alerts()).toEqual(['Write a message to the garage.']);

    type('Too short');
    await settle();
    await send();
    expect(alerts()).toEqual(['The message is at least 10 characters.']);
  });

  it('clears the message once the field is fixed', async () => {
    await open();
    pick('rar');
    await send();
    expect(alerts()).toHaveLength(1);

    type('Autorizația RAR a expirat.');
    await settle();

    expect(alerts()).toEqual([]);
    expect(note().hasAttribute('aria-invalid')).toBe(false);
  });

  it.each([
    ['ten code points', '🚗bcdefghij'],
    ['1,000 code points', `${'🚗'.repeat(10)}${'a'.repeat(990)}`],
  ])('closes with the reason and a note of %s', async (_name, value) => {
    await open();
    pick('photos');
    type(value);
    await settle();

    await send();

    await expect(result).resolves.toEqual({ note: value, reason: 'photos' });
  });

  it('closes with the note trimmed', async () => {
    await open();
    pick('rar');
    type('   Autorizația RAR a expirat.  \n');
    await settle();

    await send();

    await expect(result).resolves.toEqual({
      note: 'Autorizația RAR a expirat.',
      reason: 'rar',
    });
  });

  it('opens with the values it is given, the named field marked', async () => {
    await open({
      note: 'Prea scurt',
      reason: 'address',
      refused: 'noteTooShort',
    });

    expect(radio('address').checked).toBe(true);
    expect(note().value).toBe('Prea scurt');
    expect(alerts()).toEqual(['Mesajul are cel puțin 10 caractere.']);
    expect(note().getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(note());
  });

  it('closes as cancelled on "Renunță", sending nothing', async () => {
    await open();
    pick('rar');

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
