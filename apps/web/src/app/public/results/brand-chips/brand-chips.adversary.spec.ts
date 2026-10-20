import { PLATFORM_ID, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import {
  type BrandDto,
  BrandsService,
  type CarDto,
  CarsService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { BrandChips } from './brand-chips';
import { Session } from '../../../dashboard/session';
import { SignInDialog } from '../../../sign-in/sign-in-dialog';

const brand = (name: string, popularity: number | null = 1): BrandDto => ({
  id: `id-${name}`,
  name,
  popularity,
  slug: name.toLowerCase(),
});
const POPULAR = [
  'BMW',
  'Volkswagen',
  'Dacia',
  'Toyota',
  'Mercedes',
  'Skoda',
  'Ford',
  'Tesla',
].map((name) => brand(name));
const car = (name: string): CarDto =>
  ({ brandId: `id-${name}`, brandName: name, id: `car-${name}` }) as CarDto;

let popular: jest.Mock;
let cars: jest.Mock;
let gate: jest.Mock;
let fixture: ComponentFixture<BrandChips>;
let picks: { key: string; name: string }[];

async function settle() {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r));
  fixture.detectChanges();
}

async function chips(
  options: {
    bar?: string;
    answered?: BrandDto;
    role?: 'driver' | 'garage' | 'admin' | null;
    popular?: () => Promise<BrandDto[]>;
    cars?: () => Promise<{ items: CarDto[] }>;
  } = {},
) {
  const current = signal(options.role ? { role: options.role } : null);
  const roleHint = signal(options.role ?? null);
  gate = jest.fn(async () => false);
  popular = jest.fn(options.popular ?? (async () => POPULAR));
  cars = jest.fn(options.cars ?? (async () => ({ items: [] })));
  TestBed.configureTestingModule({
    providers: [
      {
        provide: BrandsService,
        useValue: { popularBrandsControllerTiles: popular },
      },
      { provide: CarsService, useValue: { carsControllerList: cars } },
      {
        provide: Session,
        useValue: { current, load: jest.fn(async () => current()), roleHint },
      },
      { provide: SignInDialog, useValue: { gate } },
      { provide: PLATFORM_ID, useValue: 'browser' },
    ],
  });
  await TestBed.inject(I18n).enter('public');
  fixture = TestBed.createComponent(BrandChips);
  fixture.componentRef.setInput('brand', options.bar ?? 'bmw');
  if (options.answered !== null)
    fixture.componentRef.setInput('answered', options.answered ?? brand('BMW'));
  picks = [];
  fixture.componentInstance.pick.subscribe((p) => picks.push(p));
  fixture.detectChanges();
}

const host = () => fixture.nativeElement as HTMLElement;
const buttons = () => [...host().querySelectorAll<HTMLButtonElement>('button')];
const names = () => buttons().map((b) => b.textContent?.trim());
const marked = () =>
  buttons()
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => b.textContent?.trim());

afterEach(() => TestBed.resetTestingModule());

// @traces 1355-FR-012
// @traces 1355-FR-016
describe('BrandChips when its reads misbehave', () => {
  it('shows the current brand alone when the popular read rejects for a visitor', async () => {
    await chips({
      popular: async () => {
        throw new Error('boom');
      },
    });
    await settle();

    expect(names()).toEqual(['BMW']);
    expect(marked()).toEqual(['BMW']);
  });

  it('shows the visitor row and opens no sign-in dialog when the cars read rejects', async () => {
    await chips({
      cars: async () => {
        throw new Error('401');
      },
      role: 'driver',
    });
    await settle();

    expect(names()).toHaveLength(8);
    expect(marked()).toEqual(['BMW']);
    expect(gate).not.toHaveBeenCalled();
  });

  it('shows the own brands even when the popular read fails', async () => {
    await chips({
      cars: async () => ({ items: [car('Kia')] }),
      popular: async () => {
        throw new Error('boom');
      },
      role: 'driver',
    });
    await settle();

    expect(names()).toEqual(['Kia', 'BMW']);
  });

  it('reads no cars for a garage account', async () => {
    await chips({ role: 'garage' });
    await settle();

    expect(cars).not.toHaveBeenCalled();
  });

  it('reads no cars for an admin account', async () => {
    await chips({ role: 'admin' });
    await settle();

    expect(cars).not.toHaveBeenCalled();
  });

  it('shows a driver car brand once when two cars share it', async () => {
    await chips({
      cars: async () => ({ items: [car('Kia'), car('Kia'), car('Dacia')] }),
      role: 'driver',
    });
    await settle();

    expect(names().slice(0, 3)).toEqual(['Kia', 'Dacia', 'BMW']);
    expect(names().filter((n) => n === 'Kia')).toHaveLength(1);
  });

  it('shows what the popular list has when it answers empty', async () => {
    await chips({ popular: async () => [] });
    await settle();

    expect(names()).toEqual(['BMW']);
  });

  it('never shows more than 8 chips when the popular read ignores the limit', async () => {
    await chips({
      popular: async () =>
        Array.from({ length: 50 }, (_, i) => brand(`B${i}`, i + 1)),
    });
    await settle();

    expect(names()).toHaveLength(8);
    expect(names()[0]).toBe('BMW');
  });
});

// @traces 1355-FR-014
describe('BrandChips marking', () => {
  it('marks nothing when the bar names a brand the catalogue does not hold', async () => {
    await chips({ answered: null as unknown as BrandDto, bar: 'nope' });
    await settle();

    expect(marked()).toEqual([]);
    expect(names().length).toBeGreaterThan(0);
  });

  it('marks nothing and shows the popular brands before an answer arrives for an unknown bar', async () => {
    await chips({ answered: undefined, bar: 'nope' });
    await settle();

    expect(marked()).toEqual([]);
    expect(names().length).toBeGreaterThan(0);
  });

  it('marks nothing for a bar slug in capitals, which no catalogue slug is', async () => {
    await chips({ bar: 'BMW' });
    await settle();

    expect(marked()).toEqual([]);
  });

  it('emits name and slug of a tapped chip', async () => {
    await chips();
    await settle();

    buttons()
      .find((b) => b.textContent?.trim() === 'Toyota')
      ?.click();

    expect(picks).toEqual([{ key: 'toyota', name: 'Toyota' }]);
  });

  it('emits one pick per tap on two different chips tapped in a row', async () => {
    await chips();
    await settle();

    for (const n of ['Toyota', 'Dacia'])
      buttons()
        .find((b) => b.textContent?.trim() === n)
        ?.click();

    expect(picks.map((p) => p.key)).toEqual(['toyota', 'dacia']);
  });

  it('emits twice when the same unmarked chip is tapped twice before the bar changes', async () => {
    await chips();
    await settle();

    const toyota = buttons().find((b) => b.textContent?.trim() === 'Toyota');
    toyota?.click();
    toyota?.click();

    expect(picks).toHaveLength(2);
  });

  it('keeps the same buttons in place across a repeated render', async () => {
    await chips();
    await settle();
    const before = buttons();

    fixture.detectChanges();
    await settle();

    expect(buttons()).toEqual(before);
  });

  it('keeps a chip name with a hyphen on one line', async () => {
    await chips({
      popular: async () => [brand('Mercedes-Benz'), ...POPULAR.slice(0, 3)],
    });
    await settle();

    const el = buttons().find((b) => b.textContent?.trim() === 'Mercedes-Benz');
    expect(el).toBeDefined();
    expect(el?.textContent).not.toMatch(/\n\s*\S+\n/);
  });
});
