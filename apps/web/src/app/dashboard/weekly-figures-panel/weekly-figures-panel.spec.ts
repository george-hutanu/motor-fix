import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import {
  GaragesService,
  type MeDto,
  type WeeklyFigureDto,
  type WeeklyFiguresDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { BarChart, type ChartPoint } from '@motor-fix/ui-cockpit/chart';

import { WeeklyFiguresPanel } from './weekly-figures-panel';
import { Session } from '../session';

const GARAGE = 'garage-1';

const me = {
  capabilities: ['garage.profile', 'garage.requests'],
  garageAccess: [
    { features: {}, garageId: GARAGE, role: 'owner', status: 'approved' },
  ],
  garageId: GARAGE,
} as unknown as MeDto;

const DAY = 86_400_000;
const monday = (week: number) =>
  new Date(Date.UTC(2026, 8, 28) + (week - 40) * 7 * DAY);
const iso = (date: Date) => date.toISOString().slice(0, 10);

function week(
  n: number,
  views: number | null,
  requests: number | null,
  conversion: number | null = views
    ? Math.round((requests! * 1000) / views) / 10
    : null,
): WeeklyFigureDto {
  const from = monday(n);
  return {
    conversion,
    from: iso(from),
    key: `2026-W${String(n).padStart(2, '0')}`,
    requests,
    to: iso(new Date(from.getTime() + 6 * DAY)),
    views,
  };
}

const EIGHT: WeeklyFigureDto[] = [
  week(33, 310, 18),
  week(34, 402, 21),
  week(35, 0, 0, null),
  week(36, 388, 20),
  week(37, 420, 26),
  week(38, 455, 27),
  week(39, 1240, 31),
  week(40, 472, 29, 6.1),
];

let read: jest.Mock;

async function render({
  answer = async (): Promise<WeeklyFiguresDto> => ({ weeks: EIGHT }),
  language = 'ro',
}: {
  answer?: () => Promise<WeeklyFiguresDto>;
  language?: 'ro' | 'en';
} = {}) {
  read = jest.fn(answer);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: GaragesService, useValue: { garageWeeklyFigures: read } },
      { provide: Session, useValue: { shown: signal(me) } },
    ],
  });
  await TestBed.inject(I18n).enter('garage');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(WeeklyFiguresPanel);
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  await settle();
  return { element, fixture, settle };
}

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

type Rendered = Awaited<ReturnType<typeof render>>;
const charts = ({ fixture }: Rendered) =>
  fixture.debugElement
    .queryAll(By.directive(BarChart))
    .map((d) => d.componentInstance as BarChart);
const points = (rendered: Rendered, index: number): readonly ChartPoint[] =>
  charts(rendered)[index].points();
const figure = ({ element }: Rendered, kind: string) =>
  text(element.querySelector(`[data-figure="${kind}"]`));

describe('the weekly figures panel', () => {
  // @traces 1397-FR-001 1397-FR-002 1397-FR-003
  it('draws the views and the requests of the eight weeks, oldest first', async () => {
    const rendered = await render();

    expect(read).toHaveBeenCalledWith({ garageId: GARAGE });
    expect(charts(rendered).map((c) => c.title())).toEqual([
      'Vizualizări profil',
      'Cereri primite',
    ]);
    expect(points(rendered, 0).map((p) => p.label)).toEqual([
      'S33',
      'S34',
      'S35',
      'S36',
      'S37',
      'S38',
      'S39',
      'S40',
    ]);
    expect(points(rendered, 0).map((p) => p.value)).toEqual([
      310, 402, 0, 388, 420, 455, 1240, 472,
    ]);
    expect(points(rendered, 1).map((p) => p.value)).toEqual([
      18, 21, 0, 20, 26, 27, 31, 29,
    ]);
  });

  // @traces 1397-FR-002
  it("writes the latest week's figures large and labels its bars", async () => {
    const rendered = await render();

    expect(figure(rendered, 'views')).toBe('472');
    expect(figure(rendered, 'requests')).toBe('29');
    expect(charts(rendered).map((c) => c.lastLabel())).toEqual([true, true]);
  });

  // @traces 1397-FR-002 1397-FR-011
  it('groups a large figure as the language does', async () => {
    const answer = async () => ({
      weeks: [...EIGHT.slice(1), week(40, 1240, 31)],
    });

    expect(figure(await render({ answer }), 'views')).toBe('1.240');
    TestBed.resetTestingModule();
    expect(figure(await render({ answer, language: 'en' }), 'views')).toBe(
      '1,240',
    );
  });

  // @traces 1397-FR-004 1397-FR-011
  it('gives each bar a tooltip with the week, its days and the value', async () => {
    const ro = await render();

    expect(points(ro, 0).at(-1)?.tooltip).toBe('S40 · 28 sept. – 4 oct.: 472');
    expect(points(ro, 0).at(-2)?.tooltip).toBe(
      'S39 · 21 sept. – 27 sept.: 1.240',
    );
    expect(points(ro, 1).at(-1)?.tooltip).toBe('S40 · 28 sept. – 4 oct.: 29');

    TestBed.resetTestingModule();
    const en = await render({ language: 'en' });

    expect(points(en, 0).map((p) => p.label)[0]).toBe('W33');
    expect(points(en, 0).at(-1)?.tooltip).toBe('W40 · 28 Sep – 4 Oct: 472');
    expect(points(en, 0).at(-2)?.tooltip).toBe('W39 · 21 Sep – 27 Sep: 1,240');
  });

  // @traces 1397-FR-003
  it('shows a week before the approval with its label and no bar', async () => {
    const answer = async () => ({
      weeks: [
        ...[33, 34, 35, 36, 37].map((n) => week(n, null, null, null)),
        week(38, 120, 4),
        week(39, 240, 9),
        week(40, 472, 29, 6.1),
      ],
    });
    const rendered = await render({ answer });
    const views = points(rendered, 0);

    expect(views).toHaveLength(8);
    expect(views.filter((p) => p.value !== null)).toHaveLength(3);
    expect(views[0]).toEqual({ label: 'S33', value: null });
    expect(figure(rendered, 'views')).toBe('472');
  });

  // @traces 1397-FR-003
  it('labels a window across the new year with the week digits', async () => {
    const answer = async () => ({
      weeks: [
        { ...week(40, 10, 1), key: '2026-W52' },
        { ...week(40, 12, 1), key: '2027-W01' },
      ],
    });
    const rendered = await render({ answer });

    expect(points(rendered, 0).map((p) => p.label)).toEqual(['S52', 'S01']);
  });

  // @traces 1397-FR-005
  it("says how many of last week's views became requests", async () => {
    const sentence = (r: Rendered) =>
      text(r.element.querySelector('[data-sentence]'));

    expect(sentence(await render())).toBe(
      'Săptămâna trecută, 6,1% din vizualizări au devenit cereri.',
    );
    TestBed.resetTestingModule();
    expect(sentence(await render({ language: 'en' }))).toBe(
      'Last week, 6.1% of views turned into requests.',
    );

    const full = async () => ({
      weeks: [...EIGHT.slice(0, 7), week(40, 3, 5, 100)],
    });
    TestBed.resetTestingModule();
    expect(sentence(await render({ answer: full }))).toBe(
      'Săptămâna trecută, 100,0% din vizualizări au devenit cereri.',
    );
    TestBed.resetTestingModule();
    expect(sentence(await render({ answer: full, language: 'en' }))).toBe(
      'Last week, 100.0% of views turned into requests.',
    );
  });

  // @traces 1397-FR-005
  it('says last week had no views when it had none, with no percentage', async () => {
    const answer = async () => ({
      weeks: [...EIGHT.slice(0, 7), week(40, 0, 0, null)],
    });
    const rendered = await render({ answer });
    const sentence = text(rendered.element.querySelector('[data-sentence]'));

    expect(sentence).toBe('Săptămâna trecută nu a avut vizualizări.');
    expect(sentence).not.toContain('%');
    expect(figure(rendered, 'views')).toBe('0');
  });

  // @traces 1397-FR-011
  it('writes everything again in the new language without a new read', async () => {
    const rendered = await render();
    await TestBed.inject(I18n).use('en');
    await rendered.settle();

    expect(read).toHaveBeenCalledTimes(1);
    expect(points(rendered, 0).at(-1)?.tooltip).toBe(
      'W40 · 28 Sep – 4 Oct: 472',
    );
    expect(charts(rendered)[0].title()).toBe('Profile views');
    expect(text(rendered.element.querySelector('[data-sentence]'))).toBe(
      'Last week, 6.1% of views turned into requests.',
    );
  });

  // @traces 1397-FR-007
  it('shows the charts loading and no figures while the read is pending', async () => {
    const rendered = await render({ answer: () => new Promise(() => {}) });

    expect(charts(rendered).map((c) => c.loading())).toEqual([true, true]);
    expect(rendered.element.querySelector('[data-figure]')).toBeNull();
    expect(rendered.element.querySelector('[data-sentence]')).toBeNull();
  });

  // @traces 1397-FR-007
  it('says there are no figures yet when every week is empty', async () => {
    const answer = async () => ({
      weeks: [33, 34, 35, 36, 37, 38, 39, 40].map((n) =>
        week(n, null, null, null),
      ),
    });
    const rendered = await render({ answer });

    expect(text(rendered.element.querySelector('[data-empty]'))).toBe(
      'Încă nu sunt date. Primele cifre apar după prima săptămână întreagă.',
    );
    expect(charts(rendered)).toHaveLength(0);
    expect(rendered.element.querySelector('[data-figure]')).toBeNull();
    expect(rendered.element.querySelector('[data-sentence]')).toBeNull();
  });

  // @traces 1397-FR-007
  it('says a failed read failed and reads again on retry', async () => {
    let fail = true;
    const answer = async () => {
      if (fail) throw new HttpErrorResponse({ status: 500 });
      return { weeks: EIGHT };
    };
    const rendered = await render({ answer });
    const error = rendered.element.querySelector('[data-error]');

    expect(text(error)).toBe('Nu am putut încărca cifrele.');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(charts(rendered)).toHaveLength(0);

    fail = false;
    const retry =
      rendered.element.querySelector<HTMLButtonElement>('[data-retry]');
    expect(text(retry)).toBe('Reîncearcă');
    retry?.click();
    await rendered.settle();

    expect(read).toHaveBeenCalledTimes(2);
    expect(rendered.element.querySelector('[data-error]')).toBeNull();
    expect(figure(rendered, 'views')).toBe('472');
  });
});
