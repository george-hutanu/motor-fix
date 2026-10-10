import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { type CarDto, CarsService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { CarsView } from './cars-view';

const car = (over: Partial<CarDto> = {}): CarDto => ({
  brandId: 'bmw',
  brandName: 'BMW',
  createdAt: '2026-10-07T09:00:00.000Z',
  engine: null,
  fuel: 'diesel',
  id: 'car-1',
  itpUntil: null,
  model: '320d',
  odometerKm: 148200,
  plate: null,
  rcaUntil: null,
  rovinietaUntil: null,
  year: 2019,
  ...over,
});

let list: jest.Mock;
let open: jest.Mock;

async function mount(answer: () => Promise<unknown>) {
  list = jest.fn(answer);
  open = jest.fn(async () => 'cancelled');
  TestBed.configureTestingModule({
    providers: [
      { provide: CarsService, useValue: { carsControllerList: list } },
      { provide: Overlays, useValue: { open } },
      provideRouter([]),
    ],
  });
  await TestBed.inject(I18n).enter('driver');
  const fixture = TestBed.createComponent(CarsView);
  const settle = async () => {
    for (let i = 0; i < 6; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((r) => setTimeout(r));
    }
  };
  await settle();
  return { element: fixture.nativeElement as HTMLElement, settle };
}

const text = (e: Element) => (e.textContent ?? '').replace(/\s+/g, ' ').trim();
const EMPTY =
  'Adaugă prima ta mașină. O folosim ca să‑ți arătăm service‑urile potrivite și să‑ți amintim de ITP.';

afterEach(() => TestBed.resetTestingModule());

describe('Mașinile mele empty state', () => {
  it('shows exactly one add button with the empty text', async () => {
    const { element } = await mount(async () => ({ items: [] }));

    expect(text(element.querySelector('mf-empty-state')!)).toContain(EMPTY);
    expect(element.querySelectorAll('button')).toHaveLength(1);
  });

  it('shows no empty text while the read is pending', async () => {
    const { element } = await mount(() => new Promise(() => {}));

    expect(element.querySelector('mf-empty-state')).toBeNull();
    expect(text(element)).not.toContain(EMPTY);
  });

  it('shows the error and no empty text when the read fails', async () => {
    const { element } = await mount(() => Promise.reject(new Error('down')));

    expect(element.querySelector('mf-empty-state')).toBeNull();
    expect(text(element)).toContain('Ceva nu a mers. Încearcă din nou.');
  });

  it('leaves the empty state in place when the dialog is cancelled', async () => {
    const { element, settle } = await mount(async () => ({ items: [] }));
    element.querySelector('button')!.click();
    await settle();

    expect(open).toHaveBeenCalledTimes(1);
    expect(element.querySelector('mf-empty-state')).not.toBeNull();
  });

  it('leaves the empty state after a saved car and shows the card without reading again', async () => {
    const { element, settle } = await mount(async () => ({ items: [] }));
    open.mockResolvedValueOnce(car());
    element.querySelector('button')!.click();
    await settle();

    expect(element.querySelector('mf-empty-state')).toBeNull();
    expect(element.querySelectorAll('[data-car]')).toHaveLength(1);
    expect(list).toHaveBeenCalledTimes(1);
  });
});
