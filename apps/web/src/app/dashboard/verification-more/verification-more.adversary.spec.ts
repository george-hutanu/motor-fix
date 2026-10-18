import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import {
  VerificationMore,
  type VerificationMoreData,
  type VerificationMoreRequest,
} from './verification-more';

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

async function open(data: VerificationMoreData = {}) {
  TestBed.configureTestingModule({});
  const i18n = TestBed.inject(I18n);
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
const note = () =>
  panel().querySelector<HTMLTextAreaElement>('textarea') as HTMLTextAreaElement;
const tick = (code: string) =>
  panel().querySelector<HTMLInputElement>(
    `input[type="checkbox"][value="${code}"]`,
  ) as HTMLInputElement;
const alerts = () =>
  [...panel().querySelectorAll('[role="alert"]')].map((a) =>
    (a.textContent ?? '').trim(),
  );

function type(value: string) {
  note().value = value;
  note().dispatchEvent(new Event('input', { bubbles: true }));
}

async function send() {
  panel().querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
  await settle();
}

async function pending() {
  return Promise.race([
    result.then(() => 'closed'),
    new Promise((r) => setTimeout(() => r('open'), 20)),
  ]);
}

afterEach(() => {
  TestBed.resetTestingModule();
  document.body.innerHTML = '';
});

// @traces 304-FR-002
describe('the ask dialog against awkward notes', () => {
  it('keeps the dialog open on a note of nine code points whose last one is a combining mark', async () => {
    await open();
    type('abcdefgh́');

    await send();

    expect([await pending(), alerts()]).toEqual([
      'open',
      ['Cel puțin 10 caractere.'],
    ]);
  });

  it('closes with a note of ten code points made of emoji, sent as written', async () => {
    await open();
    type('🚗'.repeat(10));

    await send();

    await expect(result).resolves.toEqual({
      note: '🚗'.repeat(10),
      requestedItems: [],
    });
  });

  it('counts only trimmed code points: nine letters padded with spaces is refused', async () => {
    await open();
    type('   abcdefghi   ');

    await send();

    expect([await pending(), alerts()]).toEqual([
      'open',
      ['Cel puțin 10 caractere.'],
    ]);
  });

  it('refuses a note of tabs and line breaks as blank', async () => {
    await open();
    type('\n\t  \n');

    await send();

    expect([await pending(), alerts()]).toEqual([
      'open',
      ['Scrie ce lipsește.'],
    ]);
  });

  it('closes with a note of exactly 1,000 code points', async () => {
    await open();
    type('a'.repeat(1000));

    await send();

    const closed = (await result) as VerificationMoreRequest;
    expect(closed.note).toHaveLength(1000);
  });

  it('does not close with a note of 1,001 code points', async () => {
    await open();
    type('a'.repeat(1001));

    await send();

    expect(await pending()).toBe('open');
  });

  it('keeps the interior line breaks of a note and trims only its ends', async () => {
    await open();
    type('\n  prima linie\nal doua rand  \n');

    await send();

    await expect(result).resolves.toEqual({
      note: 'prima linie\nal doua rand',
      requestedItems: [],
    });
  });

  it('returns the ticks in the list order however they were ticked, once each', async () => {
    await open({ requestedItems: ['other', 'documents', 'other'] });
    tick('photos').click();
    tick('documents').click();
    type('Lipsește autorizația.');

    await send();

    await expect(result).resolves.toEqual({
      note: 'Lipsește autorizația.',
      requestedItems: ['photos', 'other'],
    });
  });
});
