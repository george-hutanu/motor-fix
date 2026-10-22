import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { confirmNoChange } from './no-change-dialog';

// @traces 208-FR-010

@Component({ template: '<button type="button" id="send">Trimite</button>' })
class Host {
  readonly overlays = inject(Overlays);
}

let answer: Promise<boolean>;
let opener: HTMLButtonElement;

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
  await i18n.enter('public');
  const host = TestBed.createComponent(Host);
  document.body.appendChild(host.nativeElement);
  opener = host.nativeElement.querySelector('#send');
  opener.focus();
  answer = confirmNoChange(host.componentInstance.overlays);
  await settle();
}

const dialog = () =>
  document.querySelector<HTMLElement>('[role="dialog"]') as HTMLElement;
const text = (el: Element | null) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const button = (label: RegExp) =>
  [
    ...document.querySelectorAll<HTMLButtonElement>('mf-overlay-panel button'),
  ].find((b) => label.test(text(b))) as HTMLButtonElement;

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
});

describe('the dialog asking to send an unchanged copy', () => {
  it('asks whether to send though nothing changed, with "Trimite" and "Renunță"', async () => {
    await open();

    expect(text(dialog())).toContain('Nu ai schimbat nimic. Trimiți oricum?');
    expect(button(/^Trimite$/)).toBeDefined();
    expect(button(/^Renunță$/)).toBeDefined();
  });

  it('reads in English', async () => {
    await open('en');

    expect(text(dialog())).toContain('You changed nothing. Send anyway?');
    expect(button(/^Send$/)).toBeDefined();
    expect(button(/^Cancel$/)).toBeDefined();
  });

  it('keeps both buttons a thumb’s size', () => {
    const css = readFileSync(
      join(__dirname, 'no-change-dialog.css'),
      'utf8',
    ).replace(/\s+/g, ' ');

    expect(/button \{([^}]*)\}/.exec(css)?.[1] ?? '').toContain(
      'min-height: var(--mf-tap)',
    );
  });

  it('answers yes on "Trimite"', async () => {
    await open();

    button(/^Trimite$/).click();
    await settle();

    await expect(answer).resolves.toBe(true);
  });

  it('answers no on "Renunță", focus back on the send button', async () => {
    await open();

    button(/^Renunță$/).click();
    await settle();

    await expect(answer).resolves.toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('answers no on Escape, focus back on the send button', async () => {
    await open();

    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await settle();

    await expect(answer).resolves.toBe(false);
    expect(document.activeElement).toBe(opener);
  });
});
