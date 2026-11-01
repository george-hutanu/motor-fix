import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import {
  type CarRepairDto,
  type CarRepairListDto,
  CarsService,
  type SoldCarDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { SoldCar } from './sold-car';

const sold = (over: Partial<SoldCarDto> = {}): SoldCarDto => ({
  brandName: 'VW',
  id: 'sold-1',
  model: 'Golf',
  saleDate: '2026-10-30',
  year: 2015,
  ...over,
});

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
  answer: (params: { id: string }) => Promise<CarRepairListDto>,
  car: SoldCarDto = sold(),
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
  const fixture = TestBed.createComponent(SoldCar);
  fixture.componentRef.setInput('car', car);
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
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
describe('a sold car under odd cars and answers', () => {
  it('shows the dash for a sale date that is not a date', async () => {
    const { element } = await render(
      async () => ({ items: [] }),
      sold({ saleDate: 'never' }),
    );

    expect(said(element)).toContain('—');
    expect(said(element)).not.toContain('NaN');
  });

  it('shows the Bucharest day for a sale just after local midnight', async () => {
    const { element } = await render(
      async () => ({ items: [] }),
      sold({ saleDate: '2026-10-31T22:30:00Z' }),
    );

    expect(said(element)).toContain('1 noiembrie 2026');
  });

  it('shows markup in the car name as plain text', async () => {
    const { element } = await render(
      async () => ({ items: [] }),
      sold({ brandName: '<img src=x>', model: '<b>' }),
    );

    expect(element.querySelector('img, b')).toBeNull();
    expect(said(element)).toContain('<img src=x> <b> 2015');
  });

  it('reads once when the button is pressed open, closed and open while the read is out', async () => {
    let answer: (value: CarRepairListDto) => void = () => undefined;
    const { element, settle } = await render(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );

    toggle(element)?.click();
    await settle();
    toggle(element)?.click();
    await settle();
    toggle(element)?.click();
    await settle();
    answer({ items: [repair()] });
    await settle();

    expect(repairs).toHaveBeenCalledTimes(1);
    expect(element.querySelectorAll('mf-repair-rows li')).toHaveLength(1);
  });

  it('stays closed when the history arrives after the button closed it', async () => {
    let answer: (value: CarRepairListDto) => void = () => undefined;
    const { element, settle } = await render(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );

    toggle(element)?.click();
    await settle();
    toggle(element)?.click();
    await settle();
    answer({ items: [repair()] });
    await settle();

    expect(element.querySelector('mf-repair-rows')).toBeNull();
    expect(toggle(element)?.getAttribute('aria-expanded')).toBe('false');
  });

  it('reads the history of another car once its input changes', async () => {
    const { element, fixture, settle } = await render(async ({ id }) => ({
      items: [repair({ what: `de la ${id}` })],
    }));
    toggle(element)?.click();
    await settle();

    fixture.componentRef.setInput('car', sold({ id: 'sold-2', model: 'Polo' }));
    await settle();

    expect(said(element)).not.toContain('de la sold-1');
  });

  it('does not say the car is gone for a failure that is not a 404', async () => {
    const { element, fixture, settle } = await render(async () => {
      throw new HttpErrorResponse({ status: 500 });
    });
    const gone = jest.fn();
    fixture.componentInstance.gone.subscribe(gone);

    toggle(element)?.click();
    await settle();

    expect(gone).not.toHaveBeenCalled();
  });

  it('shows the error when the read throws a plain error', async () => {
    const { element, settle } = await render(async () => {
      throw new Error('socket hang up');
    });

    toggle(element)?.click();
    await settle();

    expect(said(element)).toContain('Ceva nu a mers. Încearcă din nou.');
  });

  it('lists the rows after a failed read is retried into a success', async () => {
    let calls = 0;
    const { element, settle } = await render(async () => {
      calls += 1;
      if (calls === 1) throw new Error('offline');
      return { items: [repair(), repair({ id: 'repair-2' })] };
    });
    toggle(element)?.click();
    await settle();
    [...element.querySelectorAll('button')]
      .find((b) => b !== toggle(element))
      ?.click();
    await settle();

    expect(element.querySelectorAll('mf-repair-rows li')).toHaveLength(2);
    expect(said(element)).not.toContain('Ceva nu a mers');
  });

  it('keeps its repairs read only whatever the history holds', async () => {
    const { element, settle } = await render(async () => ({
      items: [repair({ review: { rating: 5 } as never, source: 'motorfix' })],
    }));
    toggle(element)?.click();
    await settle();

    expect(
      element.querySelectorAll('mf-repair-rows a, mf-repair-rows button'),
    ).toHaveLength(0);
  });
});
