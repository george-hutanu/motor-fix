import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { type CarDto, CarsService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { CarsView } from './cars-view';
import { AddCar } from '../add-car/add-car';
import { RemoveCar } from '../remove-car/remove-car';

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
  updatedAt: '2026-10-07T09:00:00.000Z',
  year: 2019,
  ...over,
});

let list: jest.Mock;
let open: jest.Mock;

async function render(cars: CarDto[]) {
  list = jest.fn(async () => ({ items: cars }));
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
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
  };
  await settle();
  return { element, settle };
}

const cards = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLElement>('[data-car]'),
];
const ids = (element: HTMLElement) =>
  cards(element).map((c) => c.getAttribute('data-car'));
const trigger = (card: HTMLElement) =>
  card.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
const items = () => [
  ...document.querySelectorAll<HTMLButtonElement>(
    '[role="menu"] [role="menuitem"]',
  ),
];
const text = (element: HTMLElement) =>
  (element.textContent ?? '').replace(/\s+/g, ' ').trim();

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  TestBed.resetTestingModule();
});

// @traces 092-FR-011
describe('Mașinile mele after a removal', () => {
  it('shows the empty state, and no blank screen, once the last car is removed', async () => {
    const { element, settle } = await render([car()]);
    open.mockResolvedValueOnce(true);

    trigger(cards(element)[0])?.click();
    await settle();
    items()[1].click();
    await settle();
    await settle();

    expect(cards(element)).toHaveLength(0);
    expect(text(element)).toContain('Adaugă o mașină');
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('removes the car asked about and no other when two cars share a name', async () => {
    const { element, settle } = await render([
      car({ id: 'a' }),
      car({ id: 'b' }),
      car({ id: 'c' }),
    ]);
    open.mockResolvedValueOnce(true);

    trigger(cards(element)[1])?.click();
    await settle();
    items()[1].click();
    await settle();
    await settle();

    expect(open).toHaveBeenCalledWith(
      RemoveCar,
      expect.objectContaining({ data: { car: car({ id: 'b' }) } }),
    );
    expect(ids(element)).toEqual(['a', 'c']);
  });

  it('keeps the list on a refused removal that the dialog reports as cancelled', async () => {
    const { element, settle } = await render([
      car({ id: 'a' }),
      car({ id: 'b' }),
    ]);

    trigger(cards(element)[0])?.click();
    await settle();
    items()[1].click();
    await settle();
    await settle();

    expect(ids(element)).toEqual(['a', 'b']);
  });

  it('removes a car, then removes the next one, one dialog each', async () => {
    const { element, settle } = await render([
      car({ id: 'a' }),
      car({ id: 'b' }),
    ]);
    open.mockResolvedValue(true);

    trigger(cards(element)[0])?.click();
    await settle();
    items()[1].click();
    await settle();
    await settle();
    trigger(cards(element)[0])?.click();
    await settle();
    items()[1].click();
    await settle();
    await settle();

    expect(open).toHaveBeenCalledTimes(2);
    expect(cards(element)).toHaveLength(0);
  });
});

// @traces 092-FR-010
describe('Mașinile mele after an edit', () => {
  it('does not bring back a card that was removed while its edit dialog was open', async () => {
    const { element, settle } = await render([
      car({ id: 'a' }),
      car({ id: 'b' }),
    ]);
    open.mockImplementationOnce(async (_, { data }) => {
      data.gone();
      return car({ id: 'a', model: 'M3' });
    });

    trigger(cards(element)[0])?.click();
    await settle();
    items()[0].click();
    await settle();
    await settle();

    expect(ids(element)).toEqual(['b']);
  });

  it('puts an edited brand and model on the card and in its menu name', async () => {
    const { element, settle } = await render([car({ id: 'a' })]);
    open.mockResolvedValueOnce(
      car({ brandName: 'Audi', id: 'a', model: 'A4' }),
    );

    trigger(cards(element)[0])?.click();
    await settle();
    items()[0].click();
    await settle();
    await settle();

    expect(trigger(cards(element)[0])?.getAttribute('aria-label')).toBe(
      'Acțiuni pentru Audi A4',
    );
    expect(text(cards(element)[0])).toContain('Audi A4');
  });

  it('shows no plate when the edit cleared it', async () => {
    const { element, settle } = await render([car({ plate: 'B123ABC' })]);
    expect(text(cards(element)[0])).toContain('B 123 ABC');
    open.mockResolvedValueOnce(car({ plate: null }));

    trigger(cards(element)[0])?.click();
    await settle();
    items()[0].click();
    await settle();
    await settle();

    expect(text(cards(element)[0])).not.toContain('B 123 ABC');
  });

  it('turns a date line grey with its add button when the edit cleared the date', async () => {
    const { element, settle } = await render([car({ rcaUntil: '2099-01-01' })]);
    open.mockResolvedValueOnce(car({ rcaUntil: null }));

    trigger(cards(element)[0])?.click();
    await settle();
    items()[0].click();
    await settle();
    await settle();

    const grey = [...cards(element)[0].querySelectorAll('button')].filter((b) =>
      b.textContent?.includes('RCA: adaugă data'),
    );
    expect(grey).toHaveLength(1);
  });

  it.each([
    ['RCA: adaugă data', 'rcaUntil'],
    ['Rovinietă: adaugă data', 'rovinietaUntil'],
    ['ITP: adaugă data din talon', 'itpUntil'],
  ] as const)(
    'opens the edit dialog for the car of the card whose %s line was pressed',
    async (label, focus) => {
      const { element, settle } = await render([
        car({ id: 'a' }),
        car({ id: 'b' }),
      ]);

      [...cards(element)[1].querySelectorAll('button')]
        .find((b) => b.textContent?.includes(label))
        ?.click();
      await settle();

      expect(open).toHaveBeenCalledWith(
        AddCar,
        expect.objectContaining({
          data: expect.objectContaining({ car: car({ id: 'b' }), focus }),
        }),
      );
    },
  );

  it('opens one menu at a time', async () => {
    const { element, settle } = await render([
      car({ id: 'a' }),
      car({ id: 'b' }),
    ]);

    trigger(cards(element)[0])?.click();
    await settle();
    trigger(cards(element)[1])?.click();
    await settle();

    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
  });

  it('closes the menu once Modifică is chosen', async () => {
    const { element, settle } = await render([car({ id: 'a' })]);

    trigger(cards(element)[0])?.click();
    await settle();
    items()[0].click();
    await settle();

    expect(trigger(cards(element)[0])?.getAttribute('aria-expanded')).toBe(
      'false',
    );
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(0);
  });

  it('names the menu of a car with markup in its name as text', async () => {
    const { element } = await render([
      car({ brandName: '"><b>x</b>', model: "'q'" }),
    ]);

    expect(trigger(cards(element)[0])?.getAttribute('aria-label')).toBe(
      `Acțiuni pentru "><b>x</b> 'q'`,
    );
    expect(cards(element)[0].querySelector('.name b')).toBeNull();
  });
});
