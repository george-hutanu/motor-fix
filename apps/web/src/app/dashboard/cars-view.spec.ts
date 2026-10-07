import { TestBed } from '@angular/core/testing';
import { type CarDto, CarsService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { AddCar } from './add-car';
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

async function render(
  answer: CarDto[] | Promise<never> = [car()],
  language: 'ro' | 'en' = 'ro',
) {
  list = jest.fn(() =>
    answer instanceof Promise ? answer : Promise.resolve({ items: answer }),
  );
  open = jest.fn(async () => 'cancelled');
  TestBed.configureTestingModule({
    providers: [
      { provide: CarsService, useValue: { carsControllerList: list } },
      { provide: Overlays, useValue: { open } },
    ],
  });
  await TestBed.inject(I18n).enter('driver');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(CarsView);
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
  };
  return { element, fixture, settle };
}

const text = (element: HTMLElement) =>
  (element.textContent ?? '').replace(/\s+/g, ' ').trim();
const button = (element: HTMLElement, name: string) =>
  [...element.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === name,
  );
const cards = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLElement>('[data-car]'),
];
const lines = (card: HTMLElement) =>
  [...card.querySelectorAll<HTMLElement>('p')].map((p) =>
    (p.textContent ?? '').replace(/\s+/g, ' ').trim(),
  );

describe('Mașinile mele', () => {
  it('reads the cars once and shows a card per car with its name and its year and kilometres', async () => {
    const { element, settle } = await render();
    await settle();

    expect(list).toHaveBeenCalledTimes(1);
    expect(button(element, 'Adaugă o mașină')).toBeDefined();
    expect(cards(element)).toHaveLength(1);
    expect(lines(cards(element)[0]).slice(0, 2)).toEqual([
      'BMW 320d',
      '2019 · 148.200 km',
    ]);
  });

  it('writes the kilometres the English way in English', async () => {
    const { element, settle } = await render([car()], 'en');
    await settle();

    expect(button(element, 'Add a car')).toBeDefined();
    expect(lines(cards(element)[0])[1]).toBe('2019 · 148,200 km');
  });

  it('asks for the ITP date in a muted line when the car has none', async () => {
    const { element, settle } = await render();
    await settle();

    const itp = lines(cards(element)[0])[2];
    expect(itp).toBe('ITP: adaugă data din talon');
    const line = cards(element)[0].querySelectorAll('p')[2];
    expect(line.classList).toContain('muted');
  });

  it('shows the ITP date in the plain text colour when the car has one', async () => {
    const { element, settle } = await render([car({ itpUntil: '2026-11-13' })]);
    await settle();

    const line = cards(element)[0].querySelectorAll('p')[2];
    expect(line.textContent?.trim()).toBe('ITP valabil până la 13 nov. 2026');
    expect(line.classList).not.toContain('muted');
  });

  it('shows the ITP date in English', async () => {
    const { element, settle } = await render(
      [car({ itpUntil: '2026-11-13' })],
      'en',
    );
    await settle();

    expect(lines(cards(element)[0])[2]).toBe('ITP valid until 13 Nov 2026');
  });

  it('shows the plate grouped, and no plate line without one', async () => {
    const { element, settle } = await render([
      car({ id: 'car-2', plate: 'B123ABC' }),
      car(),
    ]);
    await settle();

    expect(lines(cards(element)[0])[3]).toBe('B 123 ABC');
    expect(lines(cards(element)[1])).toHaveLength(3);
  });

  it('shows the shared placeholder above the button with no car', async () => {
    const { element, settle } = await render([]);
    await settle();

    expect(text(element)).toContain('Nimic aici încă.');
    expect(cards(element)).toHaveLength(0);
    expect(button(element, 'Adaugă o mașină')).toBeDefined();
  });

  it('opens the dialog with the plates already held and puts the saved car first without reading again', async () => {
    const { element, settle } = await render([
      car({ id: 'car-1', plate: 'CJ12ABC' }),
    ]);
    await settle();
    open.mockResolvedValueOnce(
      car({ brandName: 'Dacia', id: 'car-2', model: 'Logan' }),
    );

    button(element, 'Adaugă o mașină')?.click();
    await settle();

    expect(open).toHaveBeenCalledWith(AddCar, {
      data: { plates: ['CJ12ABC'] },
      shape: 'dialog',
      title: 'driver.cars.add.title',
    });
    expect(lines(cards(element)[0])[0]).toBe('Dacia Logan');
    expect(cards(element)).toHaveLength(2);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('leaves the list as it was when the dialog is cancelled', async () => {
    const { element, settle } = await render();
    await settle();

    button(element, 'Adaugă o mașină')?.click();
    await settle();

    expect(cards(element)).toHaveLength(1);
  });

  it('shows placeholders and no card while the cars load', async () => {
    const { element, fixture, settle } = await render();
    let resolve: (value: { items: CarDto[] }) => void = () => undefined;
    list.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    fixture.detectChanges();

    expect(
      element.querySelectorAll('[aria-hidden="true"].skeleton').length,
    ).toBeGreaterThan(0);
    expect(cards(element)).toHaveLength(0);

    resolve({ items: [car()] });
    await settle();
    expect(element.querySelectorAll('.skeleton')).toHaveLength(0);
    expect(cards(element)).toHaveLength(1);
  });

  it('offers to try again when the cars cannot be read, and reads again', async () => {
    const { element, settle } = await render(Promise.reject(new Error('down')));
    await settle();

    expect(text(element)).toContain('Ceva nu a mers. Încearcă din nou.');
    list.mockResolvedValueOnce({ items: [car()] });
    button(element, 'Reîncearcă')?.click();
    await settle();

    expect(list).toHaveBeenCalledTimes(2);
    expect(cards(element)).toHaveLength(1);
    expect(text(element)).not.toContain('Ceva nu a mers.');
  });
});
