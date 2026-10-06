import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { PRIVACY_VERSION, TERMS_VERSION } from '@motor-fix/contracts/consent';
import { I18n } from '@motor-fix/i18n';

import { Legal } from './legal';

async function open(path: string, platform: 'browser' | 'server' = 'browser') {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { component: Legal, data: { text: 'terms' }, path: ':lang/terms' },
        { component: Legal, data: { text: 'privacy' }, path: ':lang/privacy' },
      ]),
      { provide: PLATFORM_ID, useValue: platform },
    ],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  if (path.startsWith('/en/')) await i18n.use('en');
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(path);
  harness.detectChanges();
  await harness.fixture.whenStable();
  return harness.routeNativeElement as HTMLElement;
}

const text = (page: HTMLElement) =>
  (page.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('the terms and the privacy notice', () => {
  it.each([
    ['/ro/terms', 'Termeni de utilizare', TERMS_VERSION, 'Versiunea'],
    [
      '/ro/privacy',
      'Nota de informare privind datele personale',
      PRIVACY_VERSION,
      'Versiunea',
    ],
    ['/en/terms', 'Terms of use', TERMS_VERSION, 'Version'],
    ['/en/privacy', 'Privacy notice', PRIVACY_VERSION, 'Version'],
  ])(
    '%s shows its title, its version and its text',
    async (path, title, version, versionWord) => {
      const page = await open(path);

      expect(page.querySelector('h1')?.textContent?.trim()).toBe(title);
      expect(text(page)).toContain(`${versionWord} ${version}`);
      expect(page.querySelectorAll('h2').length).toBeGreaterThan(2);
      expect(page.querySelectorAll('p').length).toBeGreaterThan(3);
    },
  );

  it('marks the Romanian text as a draft pending legal review', async () => {
    const page = await open('/ro/privacy');

    expect(text(page)).toContain(
      'Text provizoriu, în curs de revizuire juridică.',
    );
  });

  it('marks the English text as a draft pending legal review', async () => {
    const page = await open('/en/terms');

    expect(text(page)).toContain('Draft text, pending legal review.');
  });

  it('renders the whole text on the server', async () => {
    const page = await open('/ro/terms', 'server');

    expect(page.querySelector('h1')?.textContent?.trim()).toBe(
      'Termeni de utilizare',
    );
    expect(page.querySelectorAll('h2').length).toBeGreaterThan(2);
  });

  it('holds the same sections in both languages', async () => {
    const ro = await open('/ro/privacy');
    const roSections = ro.querySelectorAll('h2').length;
    TestBed.resetTestingModule();
    const en = await open('/en/privacy');

    expect(en.querySelectorAll('h2').length).toBe(roSections);
  });
});
