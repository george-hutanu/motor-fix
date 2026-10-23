import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import {
  type DocumentRefusal,
  DocumentRefuse,
  type DocumentRefuseData,
} from './document-refuse';

// @traces 068-FR-010
// @traces 068-FR-012

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

let result: Promise<OverlayResult<DocumentRefusal>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(
  data: DocumentRefuseData = { document: 'Certificat constatator ONRC' },
  language: 'ro' | 'en' = 'ro',
) {
  TestBed.configureTestingModule({});
  const i18n = TestBed.inject(I18n);
  if (language === 'en') await i18n.use('en');
  await i18n.enter('admin');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open(DocumentRefuse, {
    data,
    shape: 'dialog',
    title: 'admin.file.documents.refuse.title',
  });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const text = (el: Element | null = panel()) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const radio = (code: string) =>
  panel().querySelector<HTMLInputElement>(
    `input[type="radio"][value="${code}"]`,
  ) as HTMLInputElement;
const note = () =>
  panel().querySelector<HTMLTextAreaElement>('textarea') as HTMLTextAreaElement;
const alerts = () =>
  [...panel().querySelectorAll('[role="alert"]')].map((a) => text(a));
const button = (name: string) =>
  [...panel().querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => text(b) === name,
  ) as HTMLButtonElement;

function type(value: string) {
  note().value = value;
  note().dispatchEvent(new Event('input', { bubbles: true }));
}

afterEach(() => {
  TestBed.resetTestingModule();
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
});

describe('the refusal of a yearly document', () => {
  it('names the document and offers the two reasons and the note', async () => {
    await open();

    expect(text()).toContain('Certificat constatator ONRC');
    const labels = [...panel().querySelectorAll('label.option')].map((l) =>
      text(l),
    );
    expect(labels).toEqual(['Documente necorespunzătoare', 'Alt motiv']);
    expect(text(panel().querySelector('label[for="mf-refuse-note"]'))).toBe(
      'Mesaj pentru service',
    );
    expect(text(panel().querySelector('.count'))).toBe('0/500');
  });

  it('closes with the reason and the trimmed note', async () => {
    await open();

    radio('documents').click();
    type('  Pagina 2 lipsește  ');
    button('Refuză').click();

    await expect(result).resolves.toEqual({
      note: 'Pagina 2 lipsește',
      reason: 'documents',
    });
  });

  it('asks for a reason and a note before it closes', async () => {
    await open();

    button('Refuză').click();
    await settle();
    expect(alerts()).toEqual(['Alege un motiv.']);

    radio('other').click();
    await settle();
    button('Refuză').click();
    await settle();
    expect(alerts()).toEqual(['Scrie un mesaj pentru service.']);

    type('   ');
    button('Refuză').click();
    await settle();
    expect(alerts()).toEqual(['Scrie un mesaj pentru service.']);
  });

  it('takes a note of 500 characters, counting an emoji as one, and refuses 501', async () => {
    await open();
    radio('other').click();

    type('🙂'.repeat(500));
    await settle();
    expect(text(panel().querySelector('.count'))).toBe('500/500');

    type('a'.repeat(501));
    button('Refuză').click();
    await settle();
    expect(alerts()).toEqual(['Mesajul are cel mult 500 de caractere.']);

    type('a'.repeat(500));
    button('Refuză').click();
    await expect(result).resolves.toEqual({
      note: 'a'.repeat(500),
      reason: 'other',
    });
  });

  it('closes as cancelled with nothing sent', async () => {
    await open();

    button('Renunță').click();

    await expect(result).resolves.toBe('cancelled');
  });

  it('reads in English', async () => {
    await open({ document: 'ONRC company certificate' }, 'en');

    expect(text()).toContain('ONRC company certificate');
    const labels = [...panel().querySelectorAll('label.option')].map((l) =>
      text(l),
    );
    expect(labels).toEqual(['Documents not acceptable', 'Other reason']);
    button('Refuse').click();
    await settle();
    expect(alerts()).toEqual(['Choose a reason.']);
    radio('documents').click();
    type('a'.repeat(501));
    button('Refuse').click();
    await settle();
    expect(alerts()).toEqual(['The message has at most 500 characters.']);
    type('');
    button('Refuse').click();
    await settle();
    expect(alerts()).toEqual(['Write a message for the garage.']);
    expect(button('Cancel')).toBeDefined();
  });
});
