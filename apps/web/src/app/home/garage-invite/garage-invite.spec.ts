import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { I18n } from '@motor-fix/i18n';

import { GarageInvite } from './garage-invite';

async function render(language: 'ro' | 'en' = 'ro') {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  await i18n.use(language);
  const fixture = TestBed.createComponent(GarageInvite);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

const text = (element: Element | null | undefined) =>
  element?.textContent?.replace(/\s+/g, ' ').trim();

// @traces 228-FR-016 228-FR-018
describe('the garage invitation', () => {
  it('asks a garage to list itself and leads to the listing form', async () => {
    const root = await render();

    expect(text(root.querySelector('h2'))).toBe(
      'Ai un service? Pune‑l pe hartă.',
    );
    expect(text(root.querySelector('p'))).toBe(
      'Spune ce mărci primești, ce mărci nu și cât costă. Te sună doar cei cu lucrările pe care le vrei.',
    );
    const link = root.querySelector('a');
    expect(text(link)).toBe('Înscrie‑ți service‑ul');
    expect(link?.getAttribute('href')).toBe('/ro/list-your-garage');
  });

  it('says it in English and leads to the English form', async () => {
    const root = await render('en');

    expect(text(root.querySelector('h2'))).toBe(
      'Run a garage? Put it on the map.',
    );
    expect(text(root.querySelector('a'))).toBe('List your garage');
    expect(root.querySelector('a')?.getAttribute('href')).toBe(
      '/en/list-your-garage',
    );
  });

  it('keeps its drawing out of the accessibility tree', async () => {
    const root = await render();

    expect(root.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('gives the button a 44 px target and every text 12 px or more', () => {
    const css = readFileSync(join(__dirname, 'garage-invite.css'), 'utf8');
    const sizes = [...css.matchAll(/font-size: (\d+)px/g)].map((m) =>
      Number(m[1]),
    );

    expect(css).toMatch(/min-height: (4[4-9]|5\d)px/);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
  });
});
