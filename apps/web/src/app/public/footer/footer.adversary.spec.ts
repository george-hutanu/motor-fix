import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { PublicFooter } from './footer';
import { SignInDialog } from '../../sign-in/sign-in-dialog';

let signIn: { start: jest.Mock };

async function render(language: 'ro' | 'en' = 'ro') {
  signIn = { start: jest.fn(async () => undefined) };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: Overlays, useValue: { open: jest.fn() } },
      { provide: SignInDialog, useValue: signIn },
    ],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('consent');
  await i18n.enter('public');
  await i18n.use(language);
  const fixture = TestBed.createComponent(PublicFooter);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

const site = (root: HTMLElement) =>
  root.querySelector('nav.site') as HTMLElement;

// @traces 228-FR-017
describe('the footer links', () => {
  it('shows the logo to Home and find, list, sign in, in Romanian', async () => {
    const root = await render();

    const logo = root.querySelector('a.wordmark');
    expect(logo?.textContent?.trim()).toBe('MotorFix');
    expect(logo?.getAttribute('href')).toBe('/ro');
    expect(
      [...site(root).children].map((e) => [
        e.textContent?.trim(),
        e.getAttribute('href'),
      ]),
    ).toEqual([
      ['Găsește un mecanic', '/ro'],
      ['Înscrie‑ți service‑ul', '/ro/list-your-garage'],
      ['Autentificare', null],
    ]);
  });

  it('says them in English and points at the English pages', async () => {
    const root = await render('en');

    expect(root.querySelector('a.wordmark')?.getAttribute('href')).toBe('/en');
    expect(
      [...site(root).children].map((e) => [
        e.textContent?.trim(),
        e.getAttribute('href'),
      ]),
    ).toEqual([
      ['Find a mechanic', '/en'],
      ['List your garage', '/en/list-your-garage'],
      ['Sign in', null],
    ]);
  });

  it('opens the sign-in dialog on each tap and nothing else', async () => {
    const root = await render();
    const button = site(root).querySelector('button') as HTMLButtonElement;

    button.click();
    button.click();

    expect(signIn.start).toHaveBeenCalledTimes(2);
    expect(button.type).toBe('button');
  });

  it('keeps the legal links beside the new ones and names the two navs apart', async () => {
    const root = await render();

    const labels = [...root.querySelectorAll('nav')].map((n) =>
      n.getAttribute('aria-label'),
    );
    expect(new Set(labels).size).toBe(2);
    expect(labels).not.toContain(null);
    expect(
      [...root.querySelectorAll('nav.legal a')].map((a) =>
        a.getAttribute('href'),
      ),
    ).toEqual(['/ro/terms', '/ro/privacy', '/ro/contact']);
  });

  it('keeps every font size at 12 px or more and targets at 44 px', () => {
    const css = readFileSync(join(__dirname, 'footer.css'), 'utf8');
    const sizes = [...css.matchAll(/font-size: (\d+)px/g)].map((m) =>
      Number(m[1]),
    );

    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
    expect(css).toMatch(/min-height: (4[4-9]|[5-9]\d)px/);
  });
});
