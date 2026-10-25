import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';

import { CockpitGaugesSample } from './gauges-sample';
import { provideCockpitTheme } from './provide-cockpit-theme';

async function render() {
  TestBed.configureTestingModule({ providers: [provideCockpitTheme()] });
  const fixture = TestBed.createComponent(CockpitGaugesSample);
  await TestBed.inject(I18n).enter('cockpit');
  fixture.detectChanges();
  return { fixture, page: fixture.nativeElement as HTMLElement };
}

const figureOf = (page: HTMLElement, index: number) =>
  page.querySelectorAll('mf-odometer')[index].closest('figure');
const swap = (page: HTMLElement) =>
  [...page.querySelectorAll('button')]
    .find((b) => b.textContent?.trim() === 'Schimbă valorile')
    ?.click();

describe('CockpitGaugesSample odometer captions under hostile conditions', () => {
  // @traces 453-FR-001
  it('uses the agreed wording in Romanian', async () => {
    const { page } = await render();
    const texts = [0, 1, 2].map((i) =>
      figureOf(page, i)?.querySelector('figcaption')?.textContent?.trim(),
    );
    expect(texts).toEqual(['Un singur preț', 'Interval de preț', 'Fără preț']);
  });

  // @traces 453-FR-001
  it('uses the agreed wording in English', async () => {
    const { fixture, page } = await render();
    await TestBed.inject(I18n).use('en');
    fixture.detectChanges();
    const texts = [0, 1, 2].map((i) =>
      figureOf(page, i)?.querySelector('figcaption')?.textContent?.trim(),
    );
    expect(texts).toEqual(['One price', 'Price range', 'No price']);
  });

  // @traces 453-FR-002
  it('places each caption as a direct child of its figure, after the odometer', async () => {
    const { page } = await render();
    for (const i of [0, 1, 2]) {
      const figure = figureOf(page, i) as HTMLElement;
      const kids = [...figure.children].map((c) => c.tagName.toLowerCase());
      expect(kids).toEqual(['mf-odometer', 'figcaption']);
    }
  });

  // @traces 453-FR-002
  it('has exactly three figures and three captions on the whole sample', async () => {
    const { page } = await render();
    expect(page.querySelectorAll('figure')).toHaveLength(3);
    expect(page.querySelectorAll('figcaption')).toHaveLength(3);
  });

  // @traces 453-FR-002
  it('keeps the captions out of the odometer and out of the rating dials', async () => {
    const { page } = await render();
    expect(page.querySelectorAll('mf-odometer figcaption')).toHaveLength(0);
    expect(page.querySelectorAll('mf-rating-dial figcaption')).toHaveLength(0);
    expect(
      page.querySelectorAll('mf-rating-dial')[0].closest('figure'),
    ).toBeNull();
  });

  // @traces 453-FR-002
  it('does not hide a caption from assistive technology or override its name', async () => {
    const { page } = await render();
    for (const caption of page.querySelectorAll('figcaption')) {
      expect(caption.closest('[aria-hidden="true"]')).toBeNull();
      expect(caption.getAttribute('aria-hidden')).toBeNull();
      expect(caption.hasAttribute('hidden')).toBe(false);
    }
    for (const i of [0, 1, 2]) {
      expect(figureOf(page, i)?.getAttribute('aria-hidden')).toBeNull();
      expect(figureOf(page, i)?.getAttribute('role')).toBeNull();
    }
  });

  // @traces 453-FR-001
  it('captions the dash sample with no price and the dash alone in its figure', async () => {
    const { page } = await render();
    const figure = figureOf(page, 2) as HTMLElement;
    expect(
      figure.querySelector('[aria-hidden="true"]')?.textContent?.trim(),
    ).toBe('—');
    expect(figure.querySelector('figcaption')?.textContent?.trim()).toBe(
      'Fără preț',
    );
  });

  // @traces 453-FR-001
  it('keeps captions identical through repeated value changes', async () => {
    const { fixture, page } = await render();
    for (let n = 0; n < 5; n++) {
      swap(page);
      fixture.detectChanges();
    }
    const texts = [...page.querySelectorAll('figcaption')].map((c) =>
      c.textContent?.trim(),
    );
    expect(texts).toEqual(['Un singur preț', 'Interval de preț', 'Fără preț']);
    expect(page.querySelectorAll('figure')).toHaveLength(3);
  });

  // @traces 453-FR-003
  it('returns to Romanian captions after switching to English and back', async () => {
    const { fixture, page } = await render();
    const i18n = TestBed.inject(I18n);
    await i18n.use('en');
    await i18n.use('ro');
    fixture.detectChanges();
    const texts = [...page.querySelectorAll('figcaption')].map((c) =>
      c.textContent?.trim(),
    );
    expect(texts).toEqual(['Un singur preț', 'Interval de preț', 'Fără preț']);
  });

  // @traces 453-FR-003
  it('never shows a raw key in any caption in either language', async () => {
    const { fixture, page } = await render();
    for (const lang of ['ro', 'en', 'ro'] as const) {
      await TestBed.inject(I18n).use(lang);
      fixture.detectChanges();
      for (const c of page.querySelectorAll('figcaption')) {
        expect(c.textContent).not.toMatch(/cockpit|odometer|gauges/i);
        expect(c.textContent?.trim()).not.toBe('');
      }
    }
  });

  // @traces 453-FR-004
  it('gives the captions no fixed width or no-wrap that could clip at 320 px', async () => {
    const { page } = await render();
    for (const c of page.querySelectorAll<HTMLElement>('figcaption')) {
      expect(c.style.whiteSpace).not.toBe('nowrap');
      expect(c.style.width).toBe('');
      expect(c.style.overflow).toBe('');
    }
  });
});
