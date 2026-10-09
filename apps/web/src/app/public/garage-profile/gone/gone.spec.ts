import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { I18n } from '@motor-fix/i18n';

import { Gone } from './gone';

async function render(language: 'ro' | 'en', missing = false) {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  await i18n.use(language);
  const fixture = TestBed.createComponent(Gone);
  fixture.componentRef.setInput('missing', missing);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

// @traces 307-FR-015
describe('the no-longer-available view', () => {
  it('says the garage is gone and leads home, in Romanian', async () => {
    const page = await render('ro');

    expect(page.querySelector('h1')?.textContent?.trim()).toBe(
      'Acest service nu mai este disponibil',
    );
    expect(page.querySelector('a')?.getAttribute('href')).toBe('/ro');
  });

  it('says the same in English', async () => {
    const page = await render('en');

    expect(page.querySelector('h1')?.textContent?.trim()).toBe(
      'This garage is no longer available',
    );
    expect(page.querySelector('a')?.getAttribute('href')).toBe('/en');
  });

  it('says the page does not exist for a garage nobody can see, inside the site frame', async () => {
    const page = await render('ro', true);

    expect(page.querySelector('h1')?.textContent?.trim()).toBe(
      'Pagina nu există',
    );
    expect(page.textContent).toContain(
      'Adresa nu duce la nicio pagină MotorFix.',
    );
    expect(page.querySelector('a')?.getAttribute('href')).toBe('/ro');
    expect(page.querySelector('main, header')).toBeNull();
  });
});
