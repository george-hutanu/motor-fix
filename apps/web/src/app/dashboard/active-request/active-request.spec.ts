import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type {
  ActiveRequestAnswerDto,
  ActiveRequestDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { ActiveRequest } from './active-request';

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

const inWork = activeRequest({
  booking: {
    confirmBy: new Date(Date.now() + 3_600_000).toISOString(),
    garage: { id: 'g1', name: 'Atelier Dinamo', slug: 'atelier-dinamo' },
    startsAt: new Date().toISOString(),
    status: 'confirmed',
  },
  job: {
    etaAt: new Date(Date.now() + 7_200_000).toISOString(),
    finalPriceBani: null,
    startedAt: new Date().toISOString(),
    status: 'in_work',
    steps: [
      { id: 's1', state: 'done', text: 'Mașina pe elevator' },
      { id: 's2', state: 'done', text: 'Etriere demontate' },
      { id: 's3', state: 'now', text: 'Plăcuțe noi' },
      { id: 's4', state: 'todo', text: 'Discuri' },
      { id: 's5', state: 'todo', text: 'Probă pe drum' },
    ],
  },
  mechanicName: 'Costel Radu',
  range: { fromBani: 89_000, toBani: 140_000 },
  stage: 'in_work',
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
  return {
    element: fixture.nativeElement as HTMLElement,
    fixture,
    retried,
  };
}

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const link = (element: Element, name: string) =>
  [...element.querySelectorAll<HTMLAnchorElement>('a')].find(
    (a) => text(a) === name,
  );

afterEach(() => TestBed.resetTestingModule());

// @traces 274-request-stages-FR-019
describe('the panel while reading and after a failed read', () => {
  it('shows a busy skeleton and no Cerere nouă while reading', async () => {
    const { element } = await render(undefined);

    expect(element.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(text(element)).not.toContain('Cerere nouă');
  });

  it('says the read failed and reads again on Reîncearcă', async () => {
    const { element, retried } = await render('failed');

    expect(text(element)).toContain('Nu am putut încărca cererea.');
    expect(text(element)).not.toContain('Cerere nouă');
    const again = [...element.querySelectorAll('button')].find(
      (b) => text(b) === 'Reîncearcă',
    );
    again?.click();

    expect(retried).toHaveBeenCalledTimes(1);
  });
});

// @traces 274-request-stages-FR-017
// @traces 274-request-stages-FR-018
describe('the panel with no open request', () => {
  it('says so, with Cerere nouă to Home', async () => {
    const { element } = await render({ openCount: 0, request: null });

    expect(text(element)).toContain('Nicio cerere deschisă');
    expect(link(element, 'Cerere nouă')?.getAttribute('href')).toBe('/ro');
  });

  it('sends Cerere nouă to Home in English for an English reader', async () => {
    const { element } = await render(
      { openCount: 0, request: null },
      { language: 'en' },
    );

    expect(text(element)).toContain('No open request');
    expect(link(element, 'New request')?.getAttribute('href')).toBe('/en');
  });
});

// @traces 274-request-stages-FR-010
// @traces 274-request-stages-FR-011
describe('the panel for a request in work', () => {
  it('heads the panel and offers Cerere nouă', async () => {
    const { element } = await render({ openCount: 1, request: inWork });

    expect(text(element)).toContain('Cererea activă');
    expect(link(element, 'Cerere nouă')?.getAttribute('href')).toBe('/ro');
  });

  it('titles the job and the car, then the garage and the mechanic', async () => {
    const { element } = await render({ openCount: 1, request: inWork });

    expect(text(element)).toContain('Frâne față · BMW 320d');
    expect(text(element)).toContain('Atelier Dinamo · mecanic Costel Radu');
  });

  it('draws five stages, the current one marked for assistive technology', async () => {
    const { element } = await render({ openCount: 1, request: inWork });

    const stages = [...element.querySelectorAll('ol > li')];
    expect(stages.map(text)).toEqual([
      'Trimisă',
      'Ofertă',
      'Programată',
      'În lucru',
      'Gata',
    ]);
    expect(stages.map((s) => s.getAttribute('aria-current'))).toEqual([
      null,
      null,
      null,
      'step',
      null,
    ]);
    expect(stages.map((s) => (s as HTMLElement).dataset['state'])).toEqual([
      'done',
      'done',
      'done',
      'current',
      'later',
    ]);
  });

  it('names the stages in English for an English reader', async () => {
    const { element } = await render(
      { openCount: 1, request: inWork },
      { language: 'en' },
    );

    expect([...element.querySelectorAll('ol > li')].map(text)).toEqual([
      'Sent',
      'Quoted',
      'Booked',
      'In work',
      'Done',
    ]);
  });

  it('lists the facts as terms and values', async () => {
    const { element } = await render({ openCount: 1, request: inWork });

    const terms = [...element.querySelectorAll('dl dt')].map(text);
    expect(terms).toEqual(['Ofertă', 'Început', 'Gata, estimat']);
    expect(text(element.querySelector('dl'))).toContain('890–1.400 lei');
    expect(text(element.querySelector('dl'))).toContain('în jur de');
  });
});

// @traces 274-request-stages-FR-013
// @traces 274-request-stages-FR-014
describe('the panel’s lines', () => {
  it('says the garage has yet to confirm', async () => {
    const request = activeRequest({
      booking: { ...inWork.booking!, status: 'awaiting_confirmation' },
      stage: 'booked',
    });
    const { element } = await render({ openCount: 1, request });

    expect(text(element)).toContain('Așteaptă confirmarea service‑ului · încă');
  });

  it('says the car is ready when done', async () => {
    const request = { ...inWork, stage: 'done' as const };
    request.job = { ...inWork.job!, etaAt: null, status: 'done' };
    const { element } = await render({ openCount: 1, request });

    expect(text(element)).toContain('Mașina e gata. Poți veni după ea.');
    expect(text(element)).not.toContain('Gata, estimat');
  });

  it('says the job is paused', async () => {
    const request = {
      ...inWork,
      job: { ...inWork.job!, status: 'paused' as const },
    };
    const { element } = await render({ openCount: 1, request });

    expect(text(element)).toContain('În pauză');
  });
});

// @traces 274-request-stages-FR-015
describe('the job’s steps', () => {
  it('counts them and marks each gata, acum or nothing', async () => {
    const { element } = await render({ openCount: 1, request: inWork });

    expect(text(element)).toContain('Pașii lucrării · 2 din 5 gata');
    const rows = [...element.querySelectorAll('[data-step]')];
    expect(rows.map(text)).toEqual([
      'Mașina pe elevator gata',
      'Etriere demontate gata',
      'Plăcuțe noi acum',
      'Discuri',
      'Probă pe drum',
    ]);
  });

  it('hides the section with no step', async () => {
    const request = { ...inWork, job: { ...inWork.job!, steps: [] } };
    const { element } = await render({ openCount: 1, request });

    expect(text(element)).not.toContain('Pașii lucrării');
    expect(element.querySelector('[data-step]')).toBeNull();
  });
});

// @traces 274-request-stages-FR-016
describe('the other open requests', () => {
  it('links the rest to Cererile mele when asked to', async () => {
    const { element } = await render(
      { openCount: 3, request: inWork },
      { more: true },
    );

    expect(link(element, 'Încă 2 cereri deschise')?.getAttribute('href')).toBe(
      '/app/driver/requests',
    );
  });

  it('shows no link with one open request, or where the list is below', async () => {
    const one = await render({ openCount: 1, request: inWork }, { more: true });
    expect(text(one.element)).not.toContain('Încă');
    TestBed.resetTestingModule();

    const below = await render({ openCount: 3, request: inWork });
    expect(text(below.element)).not.toContain('Încă');
  });
});
