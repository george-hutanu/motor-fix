import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import {
  VerificationMore,
  type VerificationMoreData,
  type VerificationMoreRequest,
} from './verification-more';

// @traces 304-request-garage-details-FR-002
// @traces 304-request-garage-details-FR-013

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

let result: Promise<OverlayResult<VerificationMoreRequest>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(
  data: VerificationMoreData = {},
  language: 'ro' | 'en' = 'ro',
) {
  TestBed.configureTestingModule({});
  const i18n = TestBed.inject(I18n);
  if (language === 'en') await i18n.use('en');
  await i18n.enter('admin');
  await i18n.enter('public');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open(VerificationMore, {
    data,
    shape: 'dialog',
    title: 'admin.file.more.title',
  });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const ticks = () => [
  ...panel().querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
];
const tick = (code: string) =>
  panel().querySelector<HTMLInputElement>(
    `input[type="checkbox"][value="${code}"]`,
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

async function send() {
  confirm().click();
  await settle();
}

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
});

describe('the request-for-more dialog', () => {
  it('holds the note first, then the five ticks in order, none ticked, and the two buttons', async () => {
    await open();

    const order = [...panel().querySelectorAll('textarea, fieldset')];
    expect(order.map((el) => el.tagName)).toEqual(['TEXTAREA', 'FIELDSET']);
    expect(text(panel().querySelector('label[for="mf-more-note"]'))).toBe(
      'Ce lipsește?',
    );
    expect(note().required).toBe(true);
    expect(note().hasAttribute('maxlength')).toBe(false);
    expect(text()).toContain('Service‑ul primește mesajul cuvânt cu cuvânt.');
    expect(ticks().map((t) => t.value)).toEqual([
      'documents',
      'rar',
      'address',
      'photos',
      'other',
    ]);
    expect(ticks().map((t) => t.checked)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(ticks().some((t) => t.required)).toBe(false);
    expect(ticks().map((t) => text(t.closest('label')))).toEqual([
      'Documente',
      'Autorizația RAR',
      'Adresa',
      'Fotografiile',
      'Altceva',
    ]);
    expect(text(group().querySelector('legend'))).toBe('Privește');
    expect(text(confirm())).toBe('Trimite cererea');
    expect(text(cancel())).toBe('Renunță');
  });

  it('reads in English', async () => {
    await open({}, 'en');

    expect(ticks().map((t) => text(t.closest('label')))).toEqual([
      'Documents',
      'The RAR authorisation',
      'The address',
      'The photos',
      'Something else',
    ]);
    expect(text(group().querySelector('legend'))).toBe('It concerns');
    expect(text()).toContain('The garage receives the message word for word.');
    expect(text(confirm())).toBe('Send the request');
    expect(text(cancel())).toBe('Cancel');
  });

  it('counts what is written in code points', async () => {
    await open();
    expect(text()).toContain('0/1000');

    type('Ok 🚗');
    await settle();

    expect(text()).toContain('4/1000');
  });

  it('moves focus to the note on open', async () => {
    await open();

    expect(document.activeElement).toBe(note());
  });

  it.each([
    ['an empty note', '', 'Scrie ce lipsește.'],
    ['a note of spaces', '    ', 'Scrie ce lipsește.'],
    ['nine letters', 'Abcdefghi', 'Cel puțin 10 caractere.'],
    ['nine code points, one an emoji', '🚗bcdefghi', 'Cel puțin 10 caractere.'],
    [
      '1,001 code points',
      'a'.repeat(1001),
      'Mesajul are cel mult 1000 de caractere.',
    ],
  ])(
    'refuses %s, sending nothing, marking the note and focusing it',
    async (_name, value, message) => {
      await open();
      tick('photos').click();
      type(value);
      await settle();

      await send();

      expect(alerts()).toEqual([message]);
      expect(note().getAttribute('aria-invalid')).toBe('true');
      expect(note().getAttribute('aria-describedby')).toContain(
        panel().querySelector('[role="alert"]')?.id,
      );
      expect(document.activeElement).toBe(note());
      expect(panel().isConnected).toBe(true);
    },
  );

  it('says the refusals in English', async () => {
    await open({}, 'en');
    await send();
    expect(alerts()).toEqual(['Write what is missing.']);

    type('Too short');
    await settle();
    await send();
    expect(alerts()).toEqual(['At least 10 characters.']);
  });

  it('clears the message once the note is fixed', async () => {
    await open();
    await send();
    expect(alerts()).toHaveLength(1);

    type('Lipsesc fotografiile atelierului.');
    await settle();

    expect(alerts()).toEqual([]);
    expect(note().hasAttribute('aria-invalid')).toBe(false);
  });

  it('closes with the trimmed note and the ticked codes, in their order', async () => {
    await open();
    tick('photos').click();
    tick('documents').click();
    tick('other').click();
    tick('other').click();
    type('   Lipsesc fotografiile atelierului.  \n');
    await settle();

    await send();

    await expect(result).resolves.toEqual({
      note: 'Lipsesc fotografiile atelierului.',
      requestedItems: ['documents', 'photos'],
    });
  });

  it.each([
    ['ten code points', '🚗bcdefghij'],
    ['1,000 code points', `${'🚗'.repeat(10)}${'a'.repeat(990)}`],
  ])('closes with no ticks and a note of %s', async (_name, value) => {
    await open();
    type(value);
    await settle();

    await send();

    await expect(result).resolves.toEqual({ note: value, requestedItems: [] });
  });

  it('opens with the values it is given, the note marked and focused', async () => {
    await open({
      note: 'Prea scurt',
      refused: 'noteTooShort',
      requestedItems: ['rar', 'address'],
    });

    expect(ticks().map((t) => t.checked)).toEqual([
      false,
      true,
      true,
      false,
      false,
    ]);
    expect(note().value).toBe('Prea scurt');
    expect(alerts()).toEqual(['Cel puțin 10 caractere.']);
    expect(note().getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(note());
  });

  it('closes as cancelled on "Renunță", sending nothing', async () => {
    await open();
    type('Lipsesc fotografiile atelierului.');

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

  it('gives every tick a whole row to press and both buttons the tap height', async () => {
    await open();

    for (const t of ticks()) {
      expect(t.closest('label')?.classList).toContain('option');
    }
    expect(
      [...panel().querySelectorAll('.actions button')].map((b) => b.tagName),
    ).toEqual(['BUTTON', 'BUTTON']);
  });
});
