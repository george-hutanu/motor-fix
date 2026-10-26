import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { I18n } from '@motor-fix/i18n';

import { FirstStepsCard } from './first-steps-card';

async function render(team: boolean, language: 'ro' | 'en' = 'ro') {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  await TestBed.inject(I18n).enter('garage');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(FirstStepsCard);
  fixture.componentRef.setInput('team', team);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const text = (el: Element | null) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const links = (element: HTMLElement) =>
  [...element.querySelectorAll('li > a')].map((a) => [
    a.getAttribute('href'),
    text(a),
  ]);

afterEach(() => TestBed.resetTestingModule());

// @traces 099-FR-008
// @traces 099-FR-011
describe('the first-steps card', () => {
  it('says the garage is verified and links to Prețuri, Profil and Mecanici', async () => {
    const element = await render(true);

    expect(text(element.querySelector('h2'))).toBe('Primii pași');
    expect(text(element.querySelector('p'))).toBe(
      'Service‑ul tău e verificat. Până la prima cerere, pregătește‑l:',
    );
    expect(links(element)).toEqual([
      ['/app/garage/prices', 'Verifică lucrările din Prețuri'],
      ['/app/garage/profile', 'Adaugă poze în Profilul service‑ului'],
      ['/app/garage/team', 'Invită echipa în Mecanici'],
    ]);
  });

  it('leaves out the team row while Mecanici is not in the menu', async () => {
    const element = await render(false);

    expect(links(element).map(([href]) => href)).toEqual([
      '/app/garage/prices',
      '/app/garage/profile',
    ]);
  });

  it('writes its texts in English', async () => {
    const element = await render(true, 'en');

    expect(text(element.querySelector('h2'))).toBe('First steps');
    expect(text(element.querySelector('p'))).toBe(
      'Your garage is verified. Until the first request, get it ready:',
    );
    expect(links(element).map(([, said]) => said)).toEqual([
      'Check the jobs on Prices',
      'Add photos to your garage profile',
      'Invite the team in Mechanics',
    ]);
  });
});
