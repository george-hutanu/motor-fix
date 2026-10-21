import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type {
  ActiveRequestAnswerDto,
  ActiveRequestDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { ActiveRequest } from './active-request';

const HOUR = 3_600_000;

const activeRequest = (
  over: Partial<ActiveRequestDto> = {},
): ActiveRequestDto => ({
  booking: null,
  car: { brand: 'BMW', model: '320d', year: 2016 },
  description: null,
  id: 'r1',
  job: null,
  jobs: [
    {
      id: 'j1',
      jobTypeId: 't1',
      nameEn: 'Front brakes',
      nameRo: 'Frâne față',
      position: 0,
    },
  ],
  mechanicName: null,
  range: null,
  stage: 'sent',
  ...over,
});

const confirmed = (): NonNullable<ActiveRequestDto['booking']> => ({
  confirmBy: new Date(Date.now() + HOUR).toISOString(),
  garage: { id: 'g1', name: 'Atelier Dinamo', slug: 'atelier-dinamo' },
  startsAt: new Date(Date.now() + 2 * HOUR).toISOString(),
  status: 'confirmed',
});

const startedJob = (
  over: Partial<NonNullable<ActiveRequestDto['job']>> = {},
): NonNullable<ActiveRequestDto['job']> => ({
  etaAt: new Date(Date.now() + 2 * HOUR).toISOString(),
  finalPriceBani: null,
  startedAt: new Date().toISOString(),
  status: 'in_work',
  steps: [],
  ...over,
});

type Answer = ActiveRequestAnswerDto | 'failed' | undefined;

async function render(
  answer: Answer,
  options: { more?: boolean; language?: 'ro' | 'en' } = {},
) {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('driver');
  if (options.language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(ActiveRequest);
  fixture.componentRef.setInput('answer', answer);
  fixture.componentRef.setInput('more', options.more ?? false);
  const retried = jest.fn();
  fixture.componentInstance.retry.subscribe(retried);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { element: fixture.nativeElement as HTMLElement, fixture, retried };
}

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const link = (element: Element, name: string) =>
  [...element.querySelectorAll<HTMLAnchorElement>('a')].find(
    (a) => text(a) === name,
  );
const stages = (element: Element) => [...element.querySelectorAll('ol > li')];

afterEach(() => {
  jest.useRealTimers();
  TestBed.resetTestingModule();
});

// @traces 274-FR-010
describe('the lit stage for every stage', () => {
  it.each([
    ['sent', 0],
    ['quoted', 1],
    ['booked', 2],
    ['in_work', 3],
    ['done', 4],
  ] as const)('marks only %s current', async (stage, index) => {
    const { element } = await render({
      openCount: 1,
      request: activeRequest({ stage }),
    });

    const current = stages(element).map((s) => s.getAttribute('aria-current'));
    expect(current.filter((c) => c === 'step')).toHaveLength(1);
    expect(current[index]).toBe('step');
  });

  it('fills every stage up to Gata and lights Gata when done', async () => {
    const { element } = await render({
      openCount: 1,
      request: activeRequest({
        booking: confirmed(),
        job: startedJob({ etaAt: null, status: 'done' }),
        stage: 'done',
      }),
    });

    expect(
      stages(element).map((s) => (s as HTMLElement).dataset['state']),
    ).toEqual(['done', 'done', 'done', 'done', 'current']);
  });
});

// @traces 274-FR-017
describe('Cerere nouă in every loaded state', () => {
  it.each(['sent', 'quoted', 'booked', 'in_work', 'done'] as const)(
    'is offered at %s',
    async (stage) => {
      const { element } = await render({
        openCount: 1,
        request: activeRequest({ stage }),
      });

      expect(link(element, 'Cerere nouă')?.getAttribute('href')).toBe('/ro');
    },
  );
});

// @traces 274-FR-011
// @traces 274-FR-014
describe('a sent request', () => {
  it('names no garage, no mechanic, no start and no estimate', async () => {
    const { element } = await render({
      openCount: 1,
      request: activeRequest({ mechanicName: 'Costel Radu' }),
    });

    expect(text(element)).toContain('Frâne față · BMW 320d');
    expect(text(element)).not.toContain('mecanic');
    expect(text(element)).not.toContain('Început');
    expect(text(element)).not.toContain('Gata, estimat');
  });
});

// @traces 274-FR-011
describe('the garage without a named mechanic', () => {
  it('shows the garage alone, with no dangling “mecanic”', async () => {
    const { element } = await render({
      openCount: 1,
      request: activeRequest({ booking: confirmed(), stage: 'booked' }),
    });

    expect(text(element)).toContain('Atelier Dinamo');
    expect(text(element)).not.toContain('mecanic');
  });
});

// @traces 274-FR-014
describe('a paused job', () => {
  it('stays at În lucru with its estimate and says it is paused', async () => {
    const { element } = await render({
      openCount: 1,
      request: activeRequest({
        booking: confirmed(),
        job: startedJob({ status: 'paused' }),
        stage: 'in_work',
      }),
    });

    expect(stages(element)[3]?.getAttribute('aria-current')).toBe('step');
    expect(text(element)).toContain('În pauză');
    expect(text(element)).toContain('Gata, estimat');
  });
});

// @traces 274-FR-012
describe('the final price on a done job', () => {
  it('sits beside the quoted range', async () => {
    const { element } = await render({
      openCount: 1,
      request: activeRequest({
        booking: confirmed(),
        job: startedJob({
          etaAt: null,
          finalPriceBani: 98_000,
          status: 'done',
        }),
        range: { fromBani: 89_000, toBani: 140_000 },
        stage: 'done',
      }),
    });

    const facts = text(element.querySelector('dl'));
    expect(facts).toContain('890–1.400 lei');
    expect(facts).toContain('980 lei');
  });
});

// @traces 274-FR-015
describe('steps written by the garage', () => {
  it('shows markup in a step as text, never as an element', async () => {
    const { element } = await render({
      openCount: 1,
      request: activeRequest({
        booking: confirmed(),
        job: startedJob({
          steps: [
            {
              id: 's1',
              state: 'now',
              text: '<img src=x onerror="alert(1)">Plăcuțe',
            },
          ],
        }),
        stage: 'in_work',
      }),
    });

    expect(element.querySelector('[data-step] img')).toBeNull();
    expect(text(element.querySelector('[data-step]'))).toBe(
      '<img src=x onerror="alert(1)">Plăcuțe acum',
    );
  });

  it('counts every step done, none marked acum', async () => {
    const { element } = await render({
      openCount: 1,
      request: activeRequest({
        booking: confirmed(),
        job: startedJob({
          steps: [
            { id: 's1', state: 'done', text: 'Ridicare' },
            { id: 's2', state: 'done', text: 'Probă' },
          ],
        }),
        stage: 'in_work',
      }),
    });

    expect(text(element)).toContain('Pașii lucrării · 2 din 2 gata');
    expect(text(element)).not.toContain('acum');
  });

  it('hides the section for a booked request with no job', async () => {
    const { element } = await render({
      openCount: 1,
      request: activeRequest({ booking: confirmed(), stage: 'booked' }),
    });

    expect(text(element)).not.toContain('Pașii lucrării');
  });
});

// @traces 274-FR-016
describe('the link to the other open requests', () => {
  it('counts the rest in English', async () => {
    const { element } = await render(
      { openCount: 3, request: activeRequest() },
      { language: 'en', more: true },
    );

    expect(link(element, '2 more open requests')?.getAttribute('href')).toBe(
      '/app/driver/requests',
    );
  });

  it('shows no link with nothing open even when asked to', async () => {
    const { element } = await render(
      { openCount: 0, request: null },
      { more: true },
    );

    expect(text(element)).not.toContain('Încă');
    expect(text(element)).toContain('Nicio cerere deschisă');
  });
});

// @traces 274-FR-019
describe('the panel moving between states', () => {
  it('drops the skeleton and the error once the answer arrives', async () => {
    const { element, fixture } = await render('failed');

    fixture.componentRef.setInput('answer', {
      openCount: 1,
      request: activeRequest(),
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(text(element)).not.toContain('Nu am putut încărca cererea.');
    expect(element.querySelector('[aria-busy="true"]')).toBeNull();
    expect(text(element)).toContain('Frâne față · BMW 320d');
  });

  it('shows the error and no stale request after a later failure', async () => {
    const { element, fixture } = await render({
      openCount: 1,
      request: activeRequest(),
    });

    fixture.componentRef.setInput('answer', 'failed');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(text(element)).toContain('Nu am putut încărca cererea.');
    expect(text(element)).not.toContain('Frâne față · BMW 320d');
    expect(element.querySelectorAll('ol > li')).toHaveLength(0);
  });

  it('asks again once per tap on Reîncearcă', async () => {
    const { element, retried } = await render('failed');
    const again = [...element.querySelectorAll('button')].find(
      (b) => text(b) === 'Reîncearcă',
    );

    again?.click();
    again?.click();
    again?.click();

    expect(retried).toHaveBeenCalledTimes(3);
  });

  it('marks nothing busy once loaded', async () => {
    const { element } = await render({ openCount: 0, request: null });

    expect(element.querySelector('[aria-busy="true"]')).toBeNull();
  });
});

// @traces 274-FR-013
describe('the time left while the panel stays open', () => {
  it('is worked out again a minute later', async () => {
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'queueMicrotask'],
      now: new Date('2026-10-09T10:00:00.000Z'),
    });
    const { element, fixture } = await render({
      openCount: 1,
      request: activeRequest({
        booking: {
          ...confirmed(),
          confirmBy: '2026-10-09T11:00:00.000Z',
          status: 'awaiting_confirmation',
        },
        stage: 'booked',
      }),
    });
    expect(text(element)).toContain('încă 1 h');

    jest.advanceTimersByTime(60_000);
    fixture.detectChanges();

    expect(text(element)).toContain('încă 59 min');
  });
});
