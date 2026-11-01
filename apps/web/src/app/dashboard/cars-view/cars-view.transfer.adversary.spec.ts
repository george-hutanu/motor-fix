import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { type CarDto, CarsService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { CarsView } from './cars-view';
import type { fakeLive } from '../garage-requests/garage-requests.testing';
import { Live } from '../live';
import { heldForDriver } from '../resources/resources.testing';

const car = (over: Partial<CarDto> = {}): CarDto => ({
  brandId: 'bmw',
  brandName: 'BMW',
  createdAt: '2026-10-07T09:00:00.000Z',
  engine: null,
  fuel: 'diesel',
  id: 'car-1',
  itpUntil: null,
  model: '320d',
  nextServiceKm: null,
  odometerKm: 148200,
  plate: null,
  rcaUntil: null,
  rovinietaUntil: null,
  serviceDueOn: null,
  transfer: null,
  updatedAt: '2026-10-07T09:00:00.000Z',
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
      {
        provide: CarsService,
        useValue: {
          carHistoryControllerSold: async () => ({ items: [] }),
          carsControllerList: list,
        },
      },
      { provide: Overlays, useValue: { open } },
      provideRouter([]),
      ...heldForDriver(),
    ],
  });
  await TestBed.inject(I18n).enter('driver');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  return { ...view(), view };
}

// A Mașinile mele built in the module render() set up, as on a return.
function view() {
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
const _itp = (card: HTMLElement) => {
  const lamp = card.querySelector<HTMLElement>('mf-due-date-line mf-lamp');
  return {
    link: card.querySelector('mf-due-date-line a'),
    state: lamp?.getAttribute('data-state'),
    text: (lamp?.textContent ?? '').replace(/\s+/g, ' ').trim(),
  };
};
const _lines = (card: HTMLElement) =>
  [...card.querySelectorAll<HTMLElement>('p')].map((p) =>
    (p.textContent ?? '').replace(/\s+/g, ' ').trim(),
  );

// @traces 1392-FR-001 1392-FR-004 1392-FR-009
describe('selling a car from its card', () => {
  beforeEach(() =>
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
      now: new Date('2026-10-08T09:00:00Z'),
    }),
  );
  afterEach(() => {
    jest.useRealTimers();
    document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
      n.innerHTML = '';
    });
  });

  const sold = car({
    transfer: { expiresAt: '2026-10-15T09:00:00.000Z', id: 't-1' },
  });
  const trigger = (card: HTMLElement) =>
    card.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
  const sellItem = () =>
    [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[role="menu"] [role="menuitem"]',
      ),
    ].at(2) as HTMLButtonElement;
  async function sell(element: HTMLElement, settle: () => Promise<void>) {
    trigger(cards(element)[0])?.click();
    await settle();
    sellItem().click();
    await settle();
    await settle();
  }

  it.each([
    ['2026-11-07T22:30:00.000Z', '8 nov.'],
    ['2026-12-31T22:30:00.000Z', '1 ian.'],
    ['2026-11-07T21:59:59.000Z', '7 nov.'],
  ])('writes the expiry %s as %s in Bucharest time', async (expiresAt, day) => {
    const { element, settle } = await render([
      car({ transfer: { expiresAt, id: 't-1' } }),
    ]);
    await settle();

    expect(text(cards(element)[0])).toContain(`expiră pe ${day}`);
  });

  it('keeps the menu on a neighbour while one card shows its transfer', async () => {
    const { element, settle } = await render([
      sold,
      car({ id: 'car-2', model: 'M3' }),
    ]);
    await settle();

    expect(trigger(cards(element)[0])).toBeNull();
    expect(trigger(cards(element)[1])).not.toBeNull();
    expect(button(cards(element)[1], 'Anulează transferul')).toBeUndefined();
  });

  it('reads the list once more and shows no line when the sale dialog is cancelled', async () => {
    const { element, settle } = await render();
    await settle();
    open.mockResolvedValueOnce('cancelled');

    await sell(element, settle);
    await settle();

    expect(open).toHaveBeenCalledTimes(1);
    expect(cards(element)).toHaveLength(1);
    expect(text(cards(element)[0])).not.toContain('Transfer trimis');
    expect(trigger(cards(element)[0])).not.toBeNull();
  });

  it('keeps the card when the removal confirmation that follows Nu transmit is declined', async () => {
    const { element, settle } = await render();
    await settle();
    open.mockResolvedValueOnce('remove').mockResolvedValueOnce('cancelled');

    await sell(element, settle);
    await settle();

    expect(cards(element)).toHaveLength(1);
    expect(trigger(cards(element)[0])).not.toBeNull();
  });

  it('shows the menu again when the list re-read drops the transfer after an event', async () => {
    jest.useRealTimers();
    const { element, settle } = await render([sold]);
    await settle();
    list.mockResolvedValue({ items: [car()] });

    (TestBed.inject(Live) as unknown as ReturnType<typeof fakeLive>).emit(
      'car_transfer.expired',
      'car-1',
    );
    await new Promise((resolve) => setTimeout(resolve, 350));
    await settle();

    expect(trigger(cards(element)[0])).not.toBeNull();
    expect(text(cards(element)[0])).not.toContain('Transfer trimis');
  });

  it('shows a car name carrying markup as text on the transfer card', async () => {
    const { element, settle } = await render([
      car({
        model: '<img id="pwn" src=x>',
        transfer: { expiresAt: '2026-10-15T09:00:00.000Z', id: 't-1' },
      }),
    ]);
    await settle();

    expect(element.querySelector('#pwn')).toBeNull();
  });
});
