import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { HoursSection } from '@motor-fix/contracts/garage-hours';
import { checkListing } from '@motor-fix/contracts/listing-check';
import { PublicHolidaysService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { HoursStep } from './hours-step';
import { forStep } from '../field-watch';

const judged = (value: HoursSection) =>
  forStep(checkListing({ data: { steps: { '5': { ...value } } } }), 5);

const ORDER = 'Ora de închidere trebuie să fie după deschidere';
const BREAK = 'Pauza trebuie să fie în programul zilei';

async function open(language: 'ro' | 'en' = 'ro') {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: PublicHolidaysService,
        useValue: { publicHolidaysControllerList: jest.fn(async () => []) },
      },
    ],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(HoursStep);
  fixture.componentRef.setInput('problems', judged({}));
  fixture.componentInstance.value.subscribe((v) =>
    fixture.componentRef.setInput('problems', judged(v)),
  );
  await settle(fixture);
  return { fixture, i18n, step: fixture.nativeElement as HTMLElement };
}

type Fixture = Awaited<ReturnType<typeof open>>['fixture'];

async function settle(fixture: Fixture) {
  for (let i = 0; i < 3; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
  }
}

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const select = (step: HTMLElement, name: string) =>
  step.querySelector<HTMLSelectElement>(`select[name="${name}"]`);
const tick = (step: HTMLElement, name: string) =>
  step.querySelector<HTMLInputElement>(
    `input[type="checkbox"][name="${name}"]`,
  );
const regions = (step: HTMLElement, id: string) =>
  step.querySelectorAll(`[id="${id}"]`);
const texts = (step: HTMLElement) =>
  [...step.querySelectorAll('[role="status"]')]
    .filter((r) => r.id.startsWith('hours-') && r.id.endsWith('-error'))
    .filter((r) => text(r) !== '')
    .map((r) => `${r.id}=${text(r)}`)
    .sort();

async function choose(
  fixture: Fixture,
  field: HTMLSelectElement | null,
  value: string,
) {
  if (!field) throw new Error('no field');
  field.value = value;
  field.dispatchEvent(new Event('change'));
  await settle(fixture);
}

async function click(fixture: Fixture, element: HTMLElement | null) {
  if (!element) throw new Error('no element');
  element.click();
  await settle(fixture);
}

async function view(fixture: Fixture, step: HTMLElement, shown: boolean) {
  const details = step.querySelector('details');
  if (!details) throw new Error('no disclosure');
  details.open = shown;
  details.dispatchEvent(new Event('toggle'));
  await settle(fixture);
}

async function addBreak(fixture: Fixture, step: HTMLElement, day: string) {
  const scope = step.querySelector<HTMLElement>(`[data-day="${day}"]`);
  const found = [...(scope?.querySelectorAll('button') ?? [])].find(
    (b) => text(b) === 'Adaugă pauză',
  );
  await click(fixture, found ?? null);
}

const allIds = (step: HTMLElement) =>
  [...step.querySelectorAll('[id]')].map((e) => e.id);

beforeEach(() => {
  jest.useFakeTimers({
    doNotFake: [
      'nextTick',
      'setImmediate',
      'clearImmediate',
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'hrtime',
      'performance',
    ],
    now: new Date('2026-10-07T09:00:00Z'),
  });
});

afterEach(() => jest.useRealTimers());

describe('hours rows live regions, hostile use', () => {
  it('replaces a day row text in the same region when its reason changes with no valid state between', async () => {
    const { fixture, step } = await open();
    await view(fixture, step, true);
    await addBreak(fixture, step, 'mon');
    const region = step.querySelector('#hours-mon-error');
    await choose(fixture, select(step, 'mon-1-open'), '11:00');
    expect(text(region)).toBe(BREAK);

    await choose(fixture, select(step, 'mon-0-close'), '07:00');

    expect(step.querySelector('#hours-mon-error')).toBe(region);
    expect(text(region)).toBe(ORDER);
    expect(regions(step, 'hours-mon-error')).toHaveLength(1);
  });

  it('keeps one Saturday region with the error once, as the day view opens and closes', async () => {
    const { fixture, step } = await open();
    await click(fixture, tick(step, 'sat-closed'));
    await choose(fixture, select(step, 'sat-close'), '07:00');
    expect(texts(step)).toEqual([`hours-sat-error=${ORDER}`]);

    await view(fixture, step, true);
    expect(regions(step, 'hours-sat-error').length).toBeLessThanOrEqual(1);
    expect(texts(step).filter((t) => t.includes(ORDER))).toHaveLength(1);

    await view(fixture, step, false);
    expect(regions(step, 'hours-sat-error')).toHaveLength(1);
    expect(texts(step)).toEqual([`hours-sat-error=${ORDER}`]);

    await choose(fixture, select(step, 'sat-close'), '12:00');
    expect(texts(step)).toEqual([]);
    expect(regions(step, 'hours-sat-error')).toHaveLength(1);
  });

  it('gives Saturday exactly one empty polite region in the day view', async () => {
    const { fixture, step } = await open();
    await view(fixture, step, true);

    expect(regions(step, 'hours-sat-error')).toHaveLength(1);
    expect(text(regions(step, 'hours-sat-error')[0])).toBe('');
    expect(regions(step, 'hours-sat-error')[0].getAttribute('role')).toBe(
      'status',
    );
  });

  // A refused range keeps the week as it was, so the weekdays still agree and
  // the view may close; a kept break would make them differ and hold it open.
  it('keeps a day region and its fields agreeing after the view closes and reopens', async () => {
    const { fixture, step } = await open();
    await view(fixture, step, true);
    await choose(fixture, select(step, 'mon-0-close'), '07:00');
    expect(texts(step)).toEqual([`hours-mon-error=${ORDER}`]);

    await view(fixture, step, false);
    expect(regions(step, 'hours-mon-error')).toHaveLength(0);
    expect(texts(step)).toEqual([]);

    await view(fixture, step, true);
    const region = step.querySelector('#hours-mon-error');
    expect(region).not.toBeNull();
    const described = select(step, 'mon-0-close')
      ?.getAttribute('aria-describedby')
      ?.includes('hours-mon-error');
    expect(text(region) !== '').toBe(Boolean(described));
    expect(texts(step).length).toBeLessThanOrEqual(1);
  });

  it('shows two rows in error at once, each in its own region, and clears them one by one', async () => {
    const { fixture, step } = await open();
    await view(fixture, step, true);
    await addBreak(fixture, step, 'mon');
    await addBreak(fixture, step, 'tue');
    await choose(fixture, select(step, 'mon-1-open'), '11:00');
    await choose(fixture, select(step, 'tue-0-close'), '07:00');

    expect(texts(step)).toEqual([
      `hours-mon-error=${BREAK}`,
      `hours-tue-error=${ORDER}`,
    ]);

    await choose(fixture, select(step, 'mon-1-open'), '13:00');
    expect(texts(step)).toEqual([`hours-tue-error=${ORDER}`]);
    expect(regions(step, 'hours-mon-error')).toHaveLength(1);

    await choose(fixture, select(step, 'tue-0-close'), '12:00');
    expect(texts(step)).toEqual([]);
  });

  it('shows the weekdays error and a closed-day error together, each in its own region', async () => {
    const { fixture, step } = await open();
    await choose(fixture, select(step, 'weekdays-close'), '07:00');
    const day = step.querySelector<HTMLInputElement>('input[name="closedDay"]');
    if (!day) throw new Error('no day');
    day.value = '2026-10-06';
    day.dispatchEvent(new Event('input'));
    day.dispatchEvent(new Event('change'));
    await settle(fixture);
    await click(fixture, step.querySelector('button.add-closed'));

    expect(texts(step)).toEqual([
      'hours-closed-error=Data a trecut',
      `hours-weekdays-error=${ORDER}`,
    ]);
  });

  it('has no duplicate ids with the day view open, in error and at rest', async () => {
    const { fixture, step } = await open();
    const unique = (ids: string[]) => ids.length === new Set(ids).size;
    expect(unique(allIds(step))).toBe(true);

    await view(fixture, step, true);
    expect(unique(allIds(step))).toBe(true);
    await addBreak(fixture, step, 'mon');
    await choose(fixture, select(step, 'mon-1-open'), '11:00');
    expect(unique(allIds(step))).toBe(true);

    await view(fixture, step, false);
    await view(fixture, step, true);
    expect(unique(allIds(step))).toBe(true);
    for (const d of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
      expect(regions(step, `hours-${d}-error`)).toHaveLength(1);
  });

  it('keeps the region and swaps its text to English while an error shows', async () => {
    const { fixture, i18n, step } = await open();
    await choose(fixture, select(step, 'weekdays-close'), '07:00');
    const region = step.querySelector('#hours-weekdays-error');
    expect(text(region)).toBe(ORDER);

    await i18n.use('en');
    await settle(fixture);

    expect(step.querySelector('#hours-weekdays-error')).toBe(region);
    expect(text(region)).toBe('Closing must be after opening');
    expect(
      select(step, 'weekdays-close')?.getAttribute('aria-describedby'),
    ).toContain('hours-weekdays-error');
  });

  it('translates a day break error in place when the language changes', async () => {
    const { fixture, i18n, step } = await open();
    await view(fixture, step, true);
    await addBreak(fixture, step, 'mon');
    await choose(fixture, select(step, 'mon-1-open'), '11:00');
    const region = step.querySelector('#hours-mon-error');

    await i18n.use('en');
    await settle(fixture);

    expect(step.querySelector('#hours-mon-error')).toBe(region);
    expect(text(region)).not.toBe('');
    expect(text(region)).not.toBe(BREAK);
  });

  it('starts every region empty and polite in English too', async () => {
    const { fixture, step } = await open('en');
    await view(fixture, step, true);

    for (const id of [
      'hours-weekdays-error',
      'hours-mon-error',
      'hours-sun-error',
      'hours-closed-error',
    ]) {
      const found = regions(step, id);
      expect(found).toHaveLength(1);
      expect(found[0].getAttribute('aria-live')).toBe('polite');
      expect(text(found[0])).toBe('');
    }
  });

  it('keeps one error when the same invalid value is chosen twice', async () => {
    const { fixture, step } = await open();
    await choose(fixture, select(step, 'weekdays-close'), '07:00');
    await choose(fixture, select(step, 'weekdays-close'), '07:00');

    expect(texts(step)).toEqual([`hours-weekdays-error=${ORDER}`]);
    expect(regions(step, 'hours-weekdays-error')).toHaveLength(1);
  });
});
