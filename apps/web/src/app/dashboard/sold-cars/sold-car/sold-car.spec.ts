import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import {
  type CarRepairDto,
  type CarRepairListDto,
  CarsService,
  type SoldCarDto,
} from '@motor-fix/data-access';
import { formatLongDay, I18n } from '@motor-fix/i18n';

import { SoldCar } from './sold-car';

const sold: SoldCarDto = {
  brandName: 'VW',
  id: 'sold-1',
  model: 'Golf',
  saleDate: new Date(Date.now() - 86_400_000).toISOString(),
  year: 2015,
};

const repair = (over: Partial<CarRepairDto> = {}): CarRepairDto => ({
  car: { brandName: 'VW', model: 'Golf' } as CarRepairDto['car'],
  correctedBy: null,
  costBani: null,
  doneOn: '2026-06-12',
  fromPreviousOwner: false,
  garageId: null,
  garageName: 'Service Ionescu',
  id: 'repair-1',
  mechanicName: null,
  odometerKm: null,
  review: null,
  source: 'logged',
  what: 'Schimb ulei',
  ...over,
});

let repairs: jest.Mock;

async function render(
  answer: () => Promise<CarRepairListDto>,
  language: 'ro' | 'en' = 'ro',
) {
  repairs = jest.fn(answer);
  TestBed.configureTestingModule({
    providers: [
      {
        provide: CarsService,
        useValue: { carHistoryControllerSoldRepairs: repairs },
      },
    ],
  });
  await TestBed.inject(I18n).enter('driver');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(SoldCar);
  fixture.componentRef.setInput('car', sold);
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
  };
  await settle();
  return { element, fixture, settle };
}

const said = (element: HTMLElement) =>
  (element.textContent ?? '').replace(/\s+/g, ' ').trim();
const toggle = (element: HTMLElement) =>
  element.querySelector<HTMLButtonElement>('button[aria-expanded]');

// @traces 1394-FR-003 1394-FR-005
describe('a sold car', () => {
  it('reads as the car and the day it was sold, with nothing to change on it', async () => {
    const { element } = await render(async () => ({ items: [] }));

    expect(said(element)).toContain(
      `VW Golf 2015 · vândută pe ${formatLongDay(sold.saleDate, 'ro')}`,
    );
    expect(element.querySelectorAll('button')).toHaveLength(1);
    expect(element.querySelector('[aria-haspopup]')).toBeNull();
    expect(element.querySelector('mf-due-date-line, mf-oil-line')).toBeNull();
    expect(repairs).not.toHaveBeenCalled();
  });

  it('reads in English', async () => {
    const { element } = await render(async () => ({ items: [] }), 'en');

    expect(said(element)).toContain(
      `VW Golf 2015 · sold on ${formatLongDay(sold.saleDate, 'en')}`,
    );
    expect(toggle(element)?.textContent?.trim()).toBe('See the history');
    expect(toggle(element)?.getAttribute('aria-label')).toBe(
      'See the history for VW Golf',
    );
  });

  it('names its history button after the car and says it is closed', async () => {
    const { element } = await render(async () => ({ items: [] }));

    expect(toggle(element)?.textContent?.trim()).toBe('Vezi istoricul');
    expect(toggle(element)?.getAttribute('aria-label')).toBe(
      'Vezi istoricul pentru VW Golf',
    );
    expect(toggle(element)?.getAttribute('aria-expanded')).toBe('false');
  });

  it('reads the history once on the first press and lists its rows', async () => {
    const { element, settle } = await render(async () => ({
      items: [
        repair(),
        repair({ fromPreviousOwner: true, id: 'repair-2', what: 'Frâne' }),
      ],
    }));

    toggle(element)?.click();
    await settle();

    expect(repairs).toHaveBeenCalledTimes(1);
    expect(repairs).toHaveBeenCalledWith({ id: 'sold-1' });
    expect(toggle(element)?.getAttribute('aria-expanded')).toBe('true');
    expect(toggle(element)?.textContent?.trim()).toBe('Ascunde istoricul');
    expect(element.querySelectorAll('mf-repair-rows li')).toHaveLength(2);
    expect(said(element)).toContain('Adăugată de tine');
    expect(said(element)).toContain('de la proprietarul anterior');
  });

  it('closes and opens again without a second read', async () => {
    const { element, settle } = await render(async () => ({
      items: [repair()],
    }));

    toggle(element)?.click();
    await settle();
    toggle(element)?.click();
    await settle();

    expect(element.querySelector('mf-repair-rows')).toBeNull();
    expect(toggle(element)?.textContent?.trim()).toBe('Vezi istoricul');

    toggle(element)?.click();
    await settle();
    expect(element.querySelectorAll('mf-repair-rows li')).toHaveLength(1);
    expect(repairs).toHaveBeenCalledTimes(1);
  });

  it('says so when nothing was done up to the sale', async () => {
    const { element, settle } = await render(async () => ({ items: [] }));

    toggle(element)?.click();
    await settle();

    expect(said(element)).toContain('Nicio reparație până la vânzare.');
  });

  it('shows the loading state while the history is read', async () => {
    let answer: (value: CarRepairListDto) => void = () => undefined;
    const { element, settle } = await render(
      () =>
        new Promise<CarRepairListDto>((resolve) => {
          answer = resolve;
        }),
    );

    toggle(element)?.click();
    await settle();
    expect(element.querySelector('[aria-busy="true"]')).not.toBeNull();

    answer({ items: [] });
    await settle();
    expect(element.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('shows the error with a retry that reads again', async () => {
    let calls = 0;
    const { element, settle } = await render(async () => {
      calls += 1;
      if (calls === 1) throw new HttpErrorResponse({ status: 500 });
      return { items: [repair()] };
    });

    toggle(element)?.click();
    await settle();

    expect(said(element)).toContain('Ceva nu a mers. Încearcă din nou.');
    const retry = [...element.querySelectorAll('button')].find(
      (b) => b !== toggle(element),
    );
    retry?.click();
    await settle();

    expect(repairs).toHaveBeenCalledTimes(2);
    expect(element.querySelectorAll('mf-repair-rows li')).toHaveLength(1);
  });

  it('tells its list when the sold car is gone', async () => {
    const { element, fixture, settle } = await render(async () => {
      throw new HttpErrorResponse({ status: 404 });
    });
    const gone = jest.fn();
    fixture.componentInstance.gone.subscribe(gone);

    toggle(element)?.click();
    await settle();

    expect(gone).toHaveBeenCalledTimes(1);
    expect(said(element)).toContain('Ceva nu a mers. Încearcă din nou.');
  });
});
