import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { BrandDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { REDUCED_MOTION } from '@motor-fix/ui-cockpit';

import { BrandStrip } from './brand-strip';

// The phone rule block (under 768 px), where running text is held to 16 px.
const phoneRules = (css: string) =>
  /@media \(max-width: 767\.98px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';

const BRANDS: BrandDto[] = ['Dacia', 'Škoda', 'BMW'].map((name, i) => ({
  id: `b${i}`,
  name,
  popularity: i + 1,
  slug: name.toLowerCase(),
}));
const reduced = signal(false);
let fixture: ComponentFixture<BrandStrip>;

async function render(language: 'ro' | 'en' = 'ro') {
  TestBed.configureTestingModule({
    providers: [{ provide: REDUCED_MOTION, useValue: reduced }],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  await i18n.use(language);
  fixture = TestBed.createComponent(BrandStrip);
  fixture.componentRef.setInput('brands', BRANDS);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const buttons = (root: HTMLElement) => [
  ...root.querySelectorAll<HTMLButtonElement>('button'),
];
const reachable = (root: HTMLElement) =>
  buttons(root).filter(
    (b) => b.tabIndex !== -1 && !b.closest('[aria-hidden="true"]'),
  );

beforeEach(() => {
  reduced.set(false);
});

// @traces 228-FR-007 228-FR-008 228-FR-010
describe('the brand strip', () => {
  it('is a navigation named in Romanian and English', async () => {
    const root = await render();
    expect(root.querySelector('nav')?.getAttribute('aria-label')).toBe(
      'Mărcile căutate cel mai des',
    );

    TestBed.resetTestingModule();
    const en = await render('en');
    expect(en.querySelector('nav')?.getAttribute('aria-label')).toBe(
      'The most searched brands',
    );
  });

  it('offers each brand once to the keyboard and to a screen reader, named as written, in order', async () => {
    const root = await render();

    expect(reachable(root).map((b) => b.textContent?.trim())).toEqual([
      'Dacia',
      'Škoda',
      'BMW',
    ]);
    for (const button of reachable(root)) {
      expect(button.type).toBe('button');
      expect(button.getAttribute('translate')).toBe('no');
    }
  });

  it('moves a doubled list, the copy hidden from assistive technology and the keyboard', async () => {
    const root = await render();

    expect(root.querySelector('.track')?.classList).toContain('moving');
    expect(buttons(root)).toHaveLength(6);
    const copy = buttons(root).slice(3);
    for (const button of copy) {
      expect(button.tabIndex).toBe(-1);
      expect(button.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });

  it('stands still with one list when the device asks for reduced motion', async () => {
    reduced.set(true);
    const root = await render();

    expect(root.querySelector('.track')?.classList).not.toContain('moving');
    expect(buttons(root)).toHaveLength(3);
  });

  it('stops when reduced motion turns on', async () => {
    const root = await render();

    reduced.set(true);
    fixture.detectChanges();

    expect(root.querySelector('.track')?.classList).not.toContain('moving');
    expect(buttons(root)).toHaveLength(3);
  });

  it('emits the brand tapped, from the list or its copy', async () => {
    const root = await render();
    const picked: BrandDto[] = [];
    fixture.componentInstance.pick.subscribe((brand) => picked.push(brand));

    buttons(root)[1].click();
    buttons(root)[5].click();

    expect(picked.map((b) => b.slug)).toEqual(['škoda', 'bmw']);
  });

  it('loops in 36 seconds, pauses while a brand has focus, scrolls by hand when still, and keeps 12 px text', () => {
    const css = readFileSync(join(__dirname, 'brand-strip.css'), 'utf8');

    expect(css).toMatch(/animation: strip 36s linear infinite/);
    expect(css).toMatch(/translateX\(-50%\)/);
    expect(css).toMatch(/:focus-within\s*\{[^}]*animation-play-state: paused/);
    expect(css).toMatch(/overflow-x: auto/);
    expect(css).toMatch(/font-size: var\(--mf-size-label\)/);
  });

  // @traces 228-FR-018
  it('sets the brands at 16 px on a phone, where they are running text', () => {
    const css = readFileSync(join(__dirname, 'brand-strip.css'), 'utf8');

    expect(phoneRules(css)).toMatch(
      /button \{[^}]*font-size: var\(--mf-size-body\)/,
    );
  });
});
