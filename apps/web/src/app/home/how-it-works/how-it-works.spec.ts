import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { I18n } from '@motor-fix/i18n';
import { REDUCED_MOTION } from '@motor-fix/ui-cockpit';

import { HowItWorks } from './how-it-works';

const reduced = signal(false);
let fixture: ComponentFixture<HowItWorks>;
// The observer the counter waits on, and what it was told to watch.
let observed: { callback: IntersectionObserverCallback; target?: Element }[];
const scroll = jest.fn();

class FakeObserver {
  constructor(callback: IntersectionObserverCallback) {
    observed.push({ callback });
  }
  observe(target: Element) {
    observed[observed.length - 1].target = target;
  }
  disconnect() {}
  unobserve() {}
}

beforeEach(() => {
  reduced.set(false);
  observed = [];
  scroll.mockClear();
  Element.prototype.scrollIntoView = scroll;
  Object.assign(window, { IntersectionObserver: FakeObserver });
});

afterEach(() => {
  jest.useRealTimers();
});

async function render(language: 'ro' | 'en' = 'ro', address?: string) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ children: [], path: '**' }]),
      { provide: REDUCED_MOTION, useValue: reduced },
    ],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  await i18n.use(language);
  if (address) await TestBed.inject(Router).navigateByUrl(address);
  fixture = TestBed.createComponent(HowItWorks);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const text = (root: Element | null | undefined) =>
  root?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const figure = (root: HTMLElement) =>
  root.querySelector('.counter .figure')?.textContent?.trim();
const visible = () =>
  observed[0].callback(
    [{ isIntersecting: true, target: observed[0].target } as never],
    {} as never,
  );

// Every font-size in the sheet in px: a theme size token read from the
// Cockpit theme, a literal, or the smallest end of a clamp().
function fontSizes(): number[] {
  const css = readFileSync(join(__dirname, 'how-it-works.css'), 'utf8');
  const theme = readFileSync(
    join(__dirname, '../../../../../../libs/ui-cockpit/src/styles/cockpit.css'),
    'utf8',
  );
  const tokens = new Map(
    [...theme.matchAll(/(--mf-size-[a-z]+):\s*(\d+)px/g)].map((m) => [
      m[1],
      Number(m[2]),
    ]),
  );
  return [...css.matchAll(/font-size:\s*([^;]+);/g)].map(([, value]) => {
    const token = /var\((--mf-size-[a-z]+)\)/.exec(value);
    if (token) return tokens.get(token[1]) ?? Number.NaN;
    return Math.min(
      ...[...value.matchAll(/(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1])),
    );
  });
}

// @traces 228-FR-005 228-FR-018
describe('how MotorFix works', () => {
  it('heads the section with the two lines and gives the three benefits, in Romanian', async () => {
    const root = await render();
    const section = root.querySelector('section#how-it-works');

    expect(section?.getAttribute('tabindex')).toBe('-1');
    expect(text(section?.querySelector('h2'))).toBe(
      'Tot ce ai întreba la telefon. E deja pe bord.',
    );
    expect(
      [...root.querySelectorAll('article h3')].map((h) => text(h)),
    ).toEqual([
      'Lucrează pe. Nu lucrează pe.',
      'Prețuri înainte să suni.',
      'Recenzii legate de o reparație.',
    ]);
    expect(text(root)).toContain(
      'Fiecare comentariu arată mașina și lucrarea.',
    );
  });

  it('says it in English on the English page', async () => {
    const root = await render('en');

    expect(text(root.querySelector('h2'))).toBe(
      'Everything you’d ask on the phone. Already on the dash.',
    );
    expect(text(root)).toContain('Prices before you call.');
    expect(text(root)).toContain('Quoted 4,200 lei, charged 4,200 lei.');
  });

  it('shows the brands taken beside the two refused, marked as refused', async () => {
    const root = await render();

    expect(
      [...root.querySelectorAll('.chip.refused')].map((c) => text(c)),
    ).toEqual(['Fără Dacia', 'Fără Tesla']);
    expect(root.querySelectorAll('.chip:not(.refused)').length).toBeGreaterThan(
      0,
    );
  });

  it('ties the review to the car and the job, and names who wrote it', async () => {
    const root = await render();
    const review = root.querySelectorAll('article')[2];

    expect(text(review)).toContain('BMW 320d · Lanț de distribuție');
    expect(text(review)).toContain('„Ofertă 4.200 lei, plătit 4.200 lei.”');
    expect(text(review)).toContain('Andrei M.');
  });

  it('names the hourly rate and the garage as a whole for a screen reader', async () => {
    const root = await render();

    expect(root.querySelector('.counter')?.getAttribute('aria-label')).toBe(
      '180 lei pe oră la Service Dobre',
    );
  });

  it('keeps every text at 12 px or more', () => {
    const sizes = fontSizes();

    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.every((size) => size >= 12)).toBe(true);
  });

  // @traces 228-FR-018
  it('sizes its text on the Cockpit scale, 16 px for running text on a phone, and never leaves one word alone on a line of a benefit heading', () => {
    const css = readFileSync(join(__dirname, 'how-it-works.css'), 'utf8');
    const phone =
      /@media \(max-width: 767\.98px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';

    expect(css).toMatch(/h2 \{[^}]*font-size: var\(--mf-size-heading\)/);
    expect(css).toMatch(
      /@media \(min-width: 768px\) \{\s*h2 \{[^}]*font-size: var\(--mf-size-title\)/,
    );
    expect(css).toMatch(/h3 \{[^}]*font-size: var\(--mf-size-heading\)/);
    expect(css).toMatch(/h3 \{[^}]*text-wrap: balance/);
    expect(css).toMatch(/\.at \{[^}]*font-size: var\(--mf-size-body\)/);
    expect(css).toMatch(
      /blockquote \{[^}]*font-size: var\(--mf-size-subheading\)/,
    );
    expect(phone).toMatch(/\.tag \{[^}]*font-size: var\(--mf-size-body\)/);
  });
});

// @traces 228-FR-006
describe('the hourly rate counter', () => {
  it('rolls up to 180 once the section is in view', async () => {
    jest.useFakeTimers();
    const root = await render();

    expect(figure(root)).toBe('0');
    visible();
    jest.advanceTimersByTime(500);
    fixture.detectChanges();
    const midway = Number(figure(root));
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(180);

    jest.advanceTimersByTime(1000);
    fixture.detectChanges();
    expect(figure(root)).toBe('180');
  });

  it('shows 180 at once, watching nothing, under reduced motion', async () => {
    reduced.set(true);
    const root = await render();

    expect(figure(root)).toBe('180');
    expect(observed).toHaveLength(0);
  });

  it('shows 180 at once where the browser cannot tell what is in view', async () => {
    Reflect.deleteProperty(window, 'IntersectionObserver');
    const root = await render();

    expect(figure(root)).toBe('180');
  });
});

// @traces 228-FR-002
describe('the jump to how MotorFix works', () => {
  it('scrolls to the section and focuses it when the page opens at its fragment', async () => {
    const root = await render('ro', '/ro#how-it-works');

    expect(scroll).toHaveBeenCalled();
    expect(document.activeElement).toBe(
      root.querySelector('section#how-it-works'),
    );
  });

  it('scrolls and focuses again when the link is followed on the page itself', async () => {
    const root = await render('ro', '/ro');
    expect(scroll).not.toHaveBeenCalled();

    await TestBed.inject(Router).navigate(['/ro'], {
      fragment: 'how-it-works',
      onSameUrlNavigation: 'reload',
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(scroll).toHaveBeenCalled();
    expect(document.activeElement).toBe(
      root.querySelector('section#how-it-works'),
    );
  });
});
