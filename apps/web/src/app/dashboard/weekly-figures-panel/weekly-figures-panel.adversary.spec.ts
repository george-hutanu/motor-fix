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

const EIGHT = [33, 34, 35, 36, 37, 38, 39, 40].map((n) => week(n, 100 + n, 5));

let read: jest.Mock;

async function render({
  answer = async (): Promise<WeeklyFiguresDto> => ({ weeks: EIGHT }),
  language = 'ro',
  shown = me,
}: {
  answer?: () => Promise<WeeklyFiguresDto>;
  language?: 'ro' | 'en';
  shown?: MeDto | null;
} = {}) {
  read = jest.fn(answer);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: GaragesService, useValue: { garageWeeklyFigures: read } },
      { provide: Session, useValue: { shown: signal(shown) } },
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
const sentence = ({ element }: Rendered) =>
  text(element.querySelector('[data-sentence]'));

afterEach(() => TestBed.resetTestingModule());

describe('the weekly figures panel under hostile reads', () => {
  // @traces 1397-FR-007
  it('treats an empty list of weeks as no data yet', async () => {
    const rendered = await render({ answer: async () => ({ weeks: [] }) });

    expect(text(rendered.element.querySelector('[data-empty]'))).toBe(
      'Încă nu sunt date. Primele cifre apar după prima săptămână întreagă.',
    );
    expect(charts(rendered)).toHaveLength(0);
    expect(rendered.element.querySelector('[data-error]')).toBeNull();
  });

  // @traces 1397-FR-001 1397-FR-002
  it('draws a single week as the latest week', async () => {
    const rendered = await render({
      answer: async () => ({ weeks: [week(40, 7, 2)] }),
    });

    expect(points(rendered, 0).map((p) => p.label)).toEqual(['S40']);
    expect(figure(rendered, 'views')).toBe('7');
    expect(figure(rendered, 'requests')).toBe('2');
  });

  // @traces 1397-FR-002 1397-FR-011
  it('groups a seven digit figure in both languages', async () => {
    const answer = async () => ({
      weeks: [...EIGHT.slice(0, 7), week(40, 1_234_567, 12_345, 1)],
    });

    expect(figure(await render({ answer }), 'views')).toBe('1.234.567');
    TestBed.resetTestingModule();
    expect(figure(await render({ answer, language: 'en' }), 'requests')).toBe(
      '12,345',
    );
  });

  // @traces 1397-FR-005
  it('writes a zero conversion with one decimal', async () => {
    const rendered = await render({
      answer: async () => ({
        weeks: [...EIGHT.slice(0, 7), week(40, 50, 0, 0)],
      }),
    });

    expect(sentence(rendered)).toBe(
      'Săptămâna trecută, 0,0% din vizualizări au devenit cereri.',
    );
    expect(figure(rendered, 'requests')).toBe('0');
  });

  // @traces 1397-FR-005
  it('writes a whole-number conversion with a trailing decimal in English', async () => {
    const rendered = await render({
      answer: async () => ({
        weeks: [...EIGHT.slice(0, 7), week(40, 10, 2, 20)],
      }),
      language: 'en',
    });

    expect(sentence(rendered)).toBe(
      'Last week, 20.0% of views turned into requests.',
    );
  });

  // @traces 1397-FR-005
  it('uses the read conversion and not its own division', async () => {
    const rendered = await render({
      answer: async () => ({
        weeks: [...EIGHT.slice(0, 7), week(40, 3, 1, 33.3)],
      }),
    });

    expect(sentence(rendered)).toContain('33,3%');
  });

  // @traces 1397-FR-005
  it('says no views when the conversion is null even if views is positive', async () => {
    const rendered = await render({
      answer: async () => ({
        weeks: [...EIGHT.slice(0, 7), week(40, 12, 3, null)],
      }),
    });

    expect(sentence(rendered)).toBe('Săptămâna trecută nu a avut vizualizări.');
  });

  // @traces 1397-FR-003
  it('draws no requests bar for a week whose requests alone is null', async () => {
    const rendered = await render({
      answer: async () => ({
        weeks: [
          ...EIGHT.slice(0, 6),
          week(39, 40, null, null),
          week(40, 10, 1),
        ],
      }),
    });

    expect(points(rendered, 1).at(-2)).toEqual(
      expect.objectContaining({ label: 'S39', value: null }),
    );
    expect(points(rendered, 0).at(-2)?.value).toBe(40);
  });

  // @traces 1397-FR-003 1397-FR-004
  it('gives a null week no tooltip text with a value', async () => {
    const rendered = await render({
      answer: async () => ({
        weeks: [week(39, null, null, null), week(40, 10, 1)],
      }),
    });
    const nullWeek = points(rendered, 0)[0];

    expect(nullWeek.value).toBeNull();
    expect(nullWeek.tooltip ?? '').not.toMatch(/:\s*(null|0|NaN|—)/);
  });

  // @traces 1397-FR-004
  it('gives a zero week the tooltip with a zero value', async () => {
    const rendered = await render({
      answer: async () => ({
        weeks: [week(39, 0, 0, null), week(40, 10, 1)],
      }),
    });

    expect(points(rendered, 0)[0].tooltip).toBe('S39 · 21 sept. – 27 sept.: 0');
    expect(points(rendered, 0)[0].value).toBe(0);
  });

  // @traces 1397-FR-004
  it('writes the days of a window across the new year without shifting them', async () => {
    const rendered = await render({
      answer: async () => ({
        weeks: [
          {
            conversion: 1,
            from: '2026-12-28',
            key: '2026-W53',
            requests: 1,
            to: '2027-01-03',
            views: 100,
          },
        ],
      }),
      language: 'en',
    });

    expect(points(rendered, 0)[0].tooltip).toBe('W53 · 28 Dec – 3 Jan: 100');
  });

  // @traces 1397-FR-004
  it('writes a first of the month and a last of the month as the read gives them', async () => {
    const rendered = await render({
      answer: async () => ({
        weeks: [
          {
            conversion: 1,
            from: '2026-03-30',
            key: '2026-W14',
            requests: 1,
            to: '2026-04-05',
            views: 100,
          },
        ],
      }),
    });

    expect(points(rendered, 0)[0].tooltip).toBe('S14 · 30 mart. – 5 apr.: 100');
  });

  // @traces 1397-FR-003
  it('reads a week label from a key with a different year prefix', async () => {
    const rendered = await render({
      answer: async () => ({
        weeks: [{ ...week(40, 1, 1), key: '2099-W07' }],
      }),
    });

    expect(points(rendered, 0)[0].label).toBe('S07');
  });

  // @traces 1397-FR-001
  it('keeps the order the read answers and does not sort the weeks', async () => {
    const rendered = await render({
      answer: async () => ({
        weeks: [week(40, 1, 1), week(33, 2, 1)],
      }),
    });

    expect(points(rendered, 0).map((p) => p.label)).toEqual(['S40', 'S33']);
    expect(figure(rendered, 'views')).toBe('2');
  });
});

describe('the weekly figures panel when the read fails or never comes', () => {
  // @traces 1397-FR-007
  it('shows the error for a plain Error rejection, not only an http error', async () => {
    const rendered = await render({
      answer: async () => {
        throw new Error('boom');
      },
    });

    expect(text(rendered.element.querySelector('[data-error]'))).toBe(
      'Nu am putut încărca cifrele.',
    );
  });

  // @traces 1397-FR-007
  it('shows the error for a 403 and a 404', async () => {
    for (const status of [403, 404]) {
      const rendered = await render({
        answer: async () => {
          throw new HttpErrorResponse({ status });
        },
      });
      expect(text(rendered.element.querySelector('[data-error]'))).toBe(
        'Nu am putut încărca cifrele.',
      );
      TestBed.resetTestingModule();
    }
  });

  // @traces 1397-FR-007
  it('treats a response with no weeks property as a failure or empty, never a crash', async () => {
    const rendered = await render({
      answer: async () => ({}) as unknown as WeeklyFiguresDto,
    });

    expect(
      rendered.element.querySelector('[data-error], [data-empty]'),
    ).not.toBeNull();
    expect(rendered.element.querySelector('[data-figure]')).toBeNull();
  });

  // @traces 1397-FR-007
  it('treats a null response as a failure or empty, never a crash', async () => {
    const rendered = await render({
      answer: async () => null as unknown as WeeklyFiguresDto,
    });

    expect(
      rendered.element.querySelector('[data-error], [data-empty]'),
    ).not.toBeNull();
  });

  // @traces 1397-FR-007
  it('shows the error again when the retry fails too, and keeps the button', async () => {
    const rendered = await render({
      answer: async () => {
        throw new HttpErrorResponse({ status: 500 });
      },
    });
    rendered.element.querySelector<HTMLButtonElement>('[data-retry]')?.click();
    await rendered.settle();

    expect(read).toHaveBeenCalledTimes(2);
    expect(rendered.element.querySelector('[data-error]')).not.toBeNull();
    expect(rendered.element.querySelector('[data-retry]')).not.toBeNull();
  });

  // @traces 1397-FR-007
  it('shows the skeleton while a retry is pending and no stale error', async () => {
    let attempt = 0;
    const rendered = await render({
      answer: () => {
        attempt += 1;
        if (attempt === 1) return Promise.reject(new Error('x'));
        return new Promise(() => {});
      },
    });
    rendered.element.querySelector<HTMLButtonElement>('[data-retry]')?.click();
    await rendered.settle();

    expect(rendered.element.querySelector('[data-error]')).toBeNull();
    expect(rendered.element.querySelector('[data-figure]')).toBeNull();
  });

  // @traces 1397-FR-007
  it('lets the newest read win when an older slow read answers last', async () => {
    const resolvers: ((v: WeeklyFiguresDto) => void)[] = [];
    let first = true;
    const rendered = await render({
      answer: () => {
        if (first) {
          first = false;
          return Promise.reject(new Error('x'));
        }
        return new Promise<WeeklyFiguresDto>((r) => resolvers.push(r));
      },
    });
    const retry = () =>
      rendered.element
        .querySelector<HTMLButtonElement>('[data-retry]')
        ?.click();
    retry();
    await rendered.settle();
    resolvers[0]({ weeks: [week(40, 111, 1)] });
    await rendered.settle();

    expect(figure(rendered, 'views')).toBe('111');
  });

  // @traces 1397-FR-007
  it('does not send a second read when the retry button is pressed twice in a row', async () => {
    const rendered = await render({
      answer: async () => {
        throw new Error('x');
      },
    });
    const button =
      rendered.element.querySelector<HTMLButtonElement>('[data-retry]');
    button?.click();
    button?.click();
    await rendered.settle();

    expect(read.mock.calls.length).toBeLessThanOrEqual(3);
  });

  // @traces 1397-FR-007 1397-FR-011
  it('writes the error in English after the language changes', async () => {
    const rendered = await render({
      answer: async () => {
        throw new Error('x');
      },
    });
    await TestBed.inject(I18n).use('en');
    await rendered.settle();

    expect(text(rendered.element.querySelector('[data-error]'))).toBe(
      'We could not load the figures.',
    );
    expect(text(rendered.element.querySelector('[data-retry]'))).toBe('Retry');
    expect(read).toHaveBeenCalledTimes(1);
  });

  // @traces 1397-FR-007
  it('makes the retry a native button of type button', async () => {
    const rendered = await render({
      answer: async () => {
        throw new Error('x');
      },
    });
    const button = rendered.element.querySelector('[data-retry]');

    expect(button?.tagName).toBe('BUTTON');
    expect(button?.getAttribute('type')).toBe('button');
  });

  // @traces 1397-FR-007
  it('settles without an error when the panel is destroyed before the read answers', async () => {
    let answer!: (v: WeeklyFiguresDto) => void;
    const rendered = await render({
      answer: () => new Promise((r) => (answer = r)),
    });
    rendered.fixture.destroy();
    answer({ weeks: EIGHT });
    await new Promise((r) => setTimeout(r, 0));

    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe('the weekly figures panel without a garage', () => {
  // @traces 1397-FR-008
  it('sends no read when the session shows nobody', async () => {
    await render({ shown: null }).catch(() => undefined);

    expect(read).not.toHaveBeenCalled();
  });

  // @traces 1397-FR-008
  it('sends no read when the person holds no garage access', async () => {
    await render({
      shown: {
        capabilities: [],
        garageAccess: [],
        garageId: null,
      } as unknown as MeDto,
    }).catch(() => undefined);

    expect(read).not.toHaveBeenCalled();
  });
});
