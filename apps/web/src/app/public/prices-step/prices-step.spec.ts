import { TestBed } from '@angular/core/testing';
import { fold, type PricesSection } from '@motor-fix/contracts';
import { CatalogueService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { PricesStep } from './prices-step';
import type { MarkedBrand } from '../brands-section';

// @traces 109-FR-004 109-FR-005 109-FR-006 109-FR-007 109-FR-008 109-FR-009

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const job = (n: number, key: string, nameRo: string, nameEn: string) => ({
  id: id(n),
  key,
  nameEn,
  nameRo,
});
const DIAGNOSIS = job(1, 'diagnosis', 'Diagnoză', 'Diagnosis');
const OIL = job(2, 'oil-service', 'Schimb de ulei', 'Oil service');
const BRAKES = job(3, 'front-brakes', 'Frâne față', 'Front brakes');
const CLUTCH = job(4, 'clutch', 'Ambreiaj', 'Clutch');
const CATALOGUE = [CLUTCH, DIAGNOSIS, BRAKES, OIL];
const DACIA = id(101);
const TAKEN: MarkedBrand[] = [
  { brandId: DACIA, name: 'Dacia', stance: 'works_on' },
  { brandId: id(102), name: 'Lada', stance: 'does_not_take' },
];

let search: jest.Mock;

beforeEach(() => {
  search = jest.fn(
    async ({ ids, keys, q = '' }: Record<string, string | undefined> = {}) => {
      if (ids !== undefined || keys !== undefined) {
        const wanted = new Set([
          ...(ids?.split(',') ?? []),
          ...(keys?.split(',') ?? []),
        ]);
        return {
          items: CATALOGUE.filter((j) => wanted.has(j.id) || wanted.has(j.key)),
        };
      }
      return {
        items: CATALOGUE.filter((j) => fold(j.nameRo).includes(fold(q))),
      };
    },
  );
});

async function open(
  value?: PricesSection,
  {
    current = false,
    language = 'ro',
    taken = TAKEN,
  }: { current?: boolean; language?: string; taken?: MarkedBrand[] } = {},
) {
  TestBed.configureTestingModule({
    providers: [
      {
        provide: CatalogueService,
        useValue: { jobTypesControllerSearch: search },
      },
    ],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(PricesStep);
  fixture.componentRef.setInput('value', value);
  fixture.componentRef.setInput('takenBrands', taken);
  fixture.componentRef.setInput('current', current);
  await settle(fixture);
  const step = fixture.nativeElement as HTMLElement;
  const last = () => fixture.componentInstance.value();
  return { fixture, last, step };
}

type Fixture = Awaited<ReturnType<typeof open>>['fixture'];

async function settle(fixture: Fixture) {
  for (let i = 0; i < 3; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
    // The catalogue's answer takes a few turns of the microtask queue.
    for (let turn = 0; turn < 10; turn++) await Promise.resolve();
  }
}

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const jobRows = (step: HTMLElement) => [
  ...step.querySelectorAll<HTMLElement>('li.job'),
];
const names = (step: HTMLElement) =>
  jobRows(step).map((row) => text(row.querySelector('.name')));
const lei = (scope: HTMLElement) => [
  ...scope.querySelectorAll<HTMLInputElement>('input[inputmode="numeric"]'),
];
const labour = (step: HTMLElement) =>
  lei(step.querySelector('.labour') as HTMLElement);
const searchField = (step: HTMLElement) =>
  step.querySelector<HTMLInputElement>(
    'input[type="search"]',
  ) as HTMLInputElement;
const buttonNamed = (scope: HTMLElement, name: string) =>
  [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => text(b) === name,
  ) as HTMLButtonElement;

async function typeIn(
  fixture: Fixture,
  input: HTMLInputElement,
  value: string,
) {
  input.value = value;
  input.dispatchEvent(new Event('input'));
  await settle(fixture);
}

async function leave(fixture: Fixture, input: HTMLInputElement) {
  input.dispatchEvent(new Event('blur'));
  await settle(fixture);
}

async function find(fixture: Fixture, step: HTMLElement, q: string) {
  const field = searchField(step);
  field.value = q;
  field.dispatchEvent(new Event('input'));
  // The search waits for the owner to stop typing.
  await new Promise((resolve) => setTimeout(resolve, 300));
  await settle(fixture);
}

const results = (step: HTMLElement) =>
  [
    ...step.querySelectorAll<HTMLButtonElement>(
      '.results button:not(.propose)',
    ),
  ].map(text);

describe('step 3, the prices', () => {
  it('shows diagnosis, oil service and front brakes with their names once the catalogue answers, under the labour range, writing nothing', async () => {
    const { last, step } = await open();

    expect(text(step.querySelector('.labour'))).toContain('Manoperă, pe oră');
    expect(labour(step)).toHaveLength(2);
    expect(names(step)).toEqual(['Diagnoză', 'Schimb de ulei', 'Frâne față']);
    expect(last()).toBeUndefined();
  });

  it('asks for the listed jobs by key, so a long catalogue never hides them', async () => {
    const { step } = await open();

    expect(search).toHaveBeenCalledWith({
      keys: 'diagnosis,oil-service,front-brakes',
    });
    expect(names(step)).toEqual(['Diagnoză', 'Schimb de ulei', 'Frâne față']);
  });

  it('names the kept jobs by their ids, whatever their place in the catalogue', async () => {
    const { step } = await open({
      jobs: [{ jobTypeId: id(4) }, { name: 'Reglaj faruri' }],
    });

    expect(search).toHaveBeenCalledWith({ ids: id(4) });
    expect(names(step)).toEqual(['Ambreiaj', 'Reglaj faruri']);
  });

  it('asks again when the step becomes current after the catalogue failed', async () => {
    search.mockRejectedValueOnce(new Error('down'));
    const { fixture, step } = await open();
    expect(jobRows(step)).toEqual([]);

    fixture.componentRef.setInput('current', true);
    await settle(fixture);

    expect(names(step)).toEqual(['Diagnoză', 'Schimb de ulei', 'Frâne față']);
    expect(step.querySelector('[role="status"]')).toBeNull();
  });

  it('lists the jobs of a kept labour range with no job list yet', async () => {
    const { step } = await open({ labour: { fromBani: 12_000 } });

    expect(names(step)).toEqual(['Diagnoză', 'Schimb de ulei', 'Frâne față']);
  });

  it('takes the listed jobs into the draft with the first change', async () => {
    const { fixture, last, step } = await open();

    await typeIn(fixture, labour(step)[0], '100');

    expect(last()).toEqual({
      jobs: [{ jobTypeId: id(1) }, { jobTypeId: id(2) }, { jobTypeId: id(3) }],
      labour: { fromBani: 10_000 },
    });
    expect(text(step)).toContain(
      'Intervalul cuprinde piese și manoperă, cu TVA, și e orientativ.',
    );
  });

  it('keeps a kept job list as it is and shows its values in lei', async () => {
    const { step } = await open({
      jobs: [{ fromBani: 15_000, jobTypeId: id(4), toBani: 40_000 }],
      labour: { fromBani: 12_000, toBani: 20_000 },
    });

    expect(names(step)).toEqual(['Ambreiaj']);
    expect(labour(step).map((i) => i.value)).toEqual(['120', '200']);
    expect(lei(jobRows(step)[0]).map((i) => i.value)).toEqual(['150', '400']);
  });

  it('lists nothing and says the search is down when the catalogue does not answer', async () => {
    search.mockRejectedValue(new Error('down'));

    const { last, step } = await open();

    expect(jobRows(step)).toEqual([]);
    expect(last()).toBeUndefined();
    expect(text(step.querySelector('[role="status"]'))).toBe(
      'Căutarea nu merge acum',
    );
  });

  it('holds the typed lei as bani, a pasted "1.200 lei" as 1200 lei', async () => {
    const { fixture, last, step } = await open({ jobs: [] });

    await typeIn(fixture, labour(step)[0], '150');
    await typeIn(fixture, labour(step)[1], '1.200 lei');

    expect(labour(step)[1].value).toBe('1200');
    expect(last()?.labour).toEqual({ fromBani: 15_000, toBani: 120_000 });
  });

  it('searches from the second letter, never offers a listed job, and adds the picked one', async () => {
    const { fixture, last, step } = await open();
    const asked = search.mock.calls.length;

    await find(fixture, step, 'a');
    expect(search.mock.calls.length).toBe(asked);
    expect(results(step)).toEqual([]);

    await find(fixture, step, 'ă');
    await find(fixture, step, 'am');
    expect(search).toHaveBeenLastCalledWith({ q: 'am' });
    expect(results(step)).toEqual(['Ambreiaj']);

    await find(fixture, step, 'fr');
    expect(results(step)).toEqual([]);

    await find(fixture, step, 'am');
    buttonNamed(step, 'Ambreiaj').click();
    await settle(fixture);
    expect(names(step).at(-1)).toBe('Ambreiaj');
    expect(last()?.jobs?.at(-1)).toEqual({ jobTypeId: id(4) });
    expect(searchField(step).value).toBe('');
  });

  it('says the search is down when the catalogue does not answer in time', async () => {
    const { fixture, step } = await open({ jobs: [] });
    search.mockImplementation(() => new Promise(() => undefined));
    jest.useFakeTimers();
    try {
      const field = searchField(step);
      field.value = 'fr';
      field.dispatchEvent(new Event('input'));
      await jest.advanceTimersByTimeAsync(11_000);
    } finally {
      jest.useRealTimers();
    }
    await settle(fixture);

    expect(text(step.querySelector('[role="status"]'))).toBe(
      'Căutarea nu merge acum',
    );
  });

  it('offers no new job when a job bears the typed name, accents and case aside', async () => {
    const { fixture, step } = await open();

    await find(fixture, step, 'AMBREIAJ');
    expect(results(step)).toEqual(['Ambreiaj']);
    expect(step.querySelector('.propose')).toBeNull();

    await find(fixture, step, 'diagnoza');
    expect(results(step)).toEqual([]);
    expect(step.querySelector('.propose')).toBeNull();

    await find(fixture, step, 'Ambr');
    expect(step.querySelector('.propose')).not.toBeNull();
  });

  it('drops an answer that comes after a newer search', async () => {
    let late: (value: unknown) => void = () => undefined;
    const { fixture, step } = await open({ jobs: [] });
    search.mockImplementationOnce(
      () => new Promise((resolve) => (late = resolve)),
    );

    await find(fixture, step, 'di');
    await find(fixture, step, 'am');
    late({ items: [DIAGNOSIS] });
    await settle(fixture);

    expect(results(step)).toEqual(['Ambreiaj']);
  });

  it('adds the typed text as a new job waiting for approval', async () => {
    const { fixture, last, step } = await open({ jobs: [] });

    await find(fixture, step, ' Reglaj faruri ');
    buttonNamed(step, 'Adaugă „Reglaj faruri” ca lucrare nouă').click();
    await settle(fixture);

    expect(names(step)).toEqual(['Reglaj faruri']);
    expect(text(jobRows(step)[0].querySelector('.pending'))).toBe(
      'Așteaptă aprobare',
    );
    expect(last()?.jobs).toEqual([{ name: 'Reglaj faruri' }]);
  });

  it('gives a job a different range for a brand step 2 takes, never one it refuses', async () => {
    const { fixture, last, step } = await open({
      jobs: [{ jobTypeId: id(3) }],
    });
    const row = jobRows(step)[0];

    expect(text(row.querySelector('summary'))).toBe(
      'Interval diferit pentru o marcă',
    );
    expect(buttonNamed(row, 'Lada')).toBeUndefined();
    buttonNamed(row, 'Dacia').click();
    await settle(fixture);

    expect(last()?.jobs).toEqual([
      { jobTypeId: id(3) },
      { brandId: DACIA, jobTypeId: id(3) },
    ]);
    const brand = jobRows(step)[0].querySelector('li.brand') as HTMLElement;
    expect(text(brand.querySelector('.name'))).toBe('Dacia');
    expect(lei(brand)).toHaveLength(2);
    expect(buttonNamed(jobRows(step)[0], 'Dacia')).toBeUndefined();
  });

  it('removes a job row with its brand ranges', async () => {
    const { fixture, last, step } = await open({
      jobs: [
        { jobTypeId: id(3) },
        { brandId: DACIA, jobTypeId: id(3) },
        { jobTypeId: id(4) },
      ],
    });

    (
      jobRows(step)[0].querySelector(
        'button[aria-label="Șterge Frâne față"]',
      ) as HTMLButtonElement
    ).click();
    await settle(fixture);

    expect(names(step)).toEqual(['Ambreiaj']);
    expect(last()?.jobs).toEqual([{ jobTypeId: id(4) }]);
  });

  it('stops adding at 50 jobs and says so', async () => {
    const jobs = Array.from({ length: 50 }, (_, i) => ({
      jobTypeId: id(1000 + i),
    }));
    const { step } = await open({ jobs });

    expect(buttonNamed(step, 'Adaugă o lucrare').disabled).toBe(true);
    expect(searchField(step).disabled).toBe(true);
    expect(text(step)).toContain('Cel mult 50 de lucrări');
  });

  it('names a reversed range once it is left, and warns of a wide one without an error', async () => {
    const { fixture, step } = await open({ jobs: [{ jobTypeId: id(3) }] });
    const [from, to] = lei(jobRows(step)[0]);

    await typeIn(fixture, from, '300');
    await typeIn(fixture, to, '200');
    expect(text(jobRows(step)[0].querySelector('.error'))).toBe('');
    await leave(fixture, to);
    expect(text(jobRows(step)[0].querySelector('.error'))).toBe(
      'Prețul minim trebuie să fie mai mic decât maximul',
    );
    expect(to.getAttribute('aria-invalid')).toBe('true');

    await typeIn(fixture, from, '150');
    await typeIn(fixture, to, '600');
    expect(jobRows(step)[0].querySelector('.error')).toBeNull();
    expect(text(jobRows(step)[0].querySelector('.warning'))).toBe(
      'Maximul e de peste 3 ori minimul. Verifică intervalul.',
    );
  });

  it('asks for a missing end of a left range', async () => {
    const { fixture, step } = await open({ jobs: [] });

    await typeIn(fixture, labour(step)[0], '100');
    await leave(fixture, labour(step)[0]);

    expect(text(step.querySelector('.labour .error'))).toBe(
      'Completează prețul',
    );
  });

  it('speaks English, with the job names in English', async () => {
    const { fixture, step } = await open(undefined, { language: 'en' });

    expect(names(step)).toEqual(['Diagnosis', 'Oil service', 'Front brakes']);
    await find(fixture, step, 'Headlight aim');
    expect(buttonNamed(step, 'Add “Headlight aim” as a new job')).toBeDefined();
  });
});
