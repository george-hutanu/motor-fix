import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';

import { CockpitChartsSample } from './charts-sample';

async function render() {
  const fixture = TestBed.createComponent(CockpitChartsSample);
  await TestBed.inject(I18n).enter('cockpit');
  fixture.detectChanges();
  await fixture.whenStable();
  return [fixture, fixture.nativeElement as HTMLElement] as const;
}

const text = (key: string) => TestBed.inject(I18n).t(`cockpit.charts.${key}`);
const titles = (el: HTMLElement) =>
  [...el.querySelectorAll('mf-panel h2')].map((h) => h.textContent?.trim());

describe('CockpitChartsSample', () => {
  it('shows a 12-month bar chart in lei and a 12-month line chart', async () => {
    const [, el] = await render();
    const bar = el.querySelector('mf-bar-chart');
    const line = el.querySelector('mf-line-chart');

    expect(titles(el)).toEqual(
      expect.arrayContaining([text('spend'), text('garages')]),
    );
    expect(bar?.querySelector('canvas')?.getAttribute('aria-label')).toMatch(
      /^.+, Ianuarie 2027 – Decembrie 2027\. .+ lei/,
    );
    expect(line?.querySelector('canvas')?.getAttribute('aria-label')).toMatch(
      /Ianuarie 2027 – Decembrie 2027/,
    );
  });

  it('labels the months in the current language', async () => {
    const [fixture, el] = await render();

    await TestBed.inject(I18n).use('en');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(
      el.querySelector('mf-bar-chart canvas')?.getAttribute('aria-label'),
    ).toContain('January 2027 – December 2027');
  });

  it('shows the empty, loading and error states', async () => {
    const [, el] = await render();

    expect(el.textContent).toContain('Încă nu sunt date');
    expect(el.querySelector('.mf-chart-skeleton')).not.toBeNull();
    expect(
      [...el.querySelectorAll('button')].some(
        (b) => b.textContent?.trim() === 'Reîncearcă',
      ),
    ).toBe(true);
  });

  it('draws the failed chart once retry is pressed', async () => {
    const [fixture, el] = await render();
    const retry = [...el.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Reîncearcă',
    );
    const canvases = el.querySelectorAll('canvas').length;

    retry?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(el.querySelectorAll('canvas')).toHaveLength(canvases + 1);
  });
});
