import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
import { PUBLIC_READ } from '../../../public-read';
import { SignInDialog } from '../../../sign-in/sign-in-dialog';

type Role = 'driver' | 'garage' | 'admin';

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
const ALFA = brand('Alfa', null);
const car = (name: string): CarDto =>
  ({ brandId: `id-${name}`, brandName: name, id: `car-${name}` }) as CarDto;

let popular: jest.Mock;
let cars: jest.Mock;
let load: jest.Mock;
let gate: jest.Mock;
let current: ReturnType<typeof signal<{ role: Role } | null>>;
let roleHint: ReturnType<typeof signal<Role | null>>;
let fixture: ComponentFixture<BrandChips>;
let picks: string[];

async function settle() {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r));
  fixture.detectChanges();
}

async function chips(
  options: {
    bar?: string;
    answered?: BrandDto;
    picked?: BrandDto;
    role?: Role | null;
    hint?: Role | null;
    popular?: () => Promise<BrandDto[]>;
    cars?: () => Promise<{ items: CarDto[] }>;
    platform?: string;
  } = {},
) {
  current = signal(options.role ? { role: options.role } : null);
  roleHint = signal(options.hint ?? options.role ?? null);
  load = jest.fn(async () => current());
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
      { provide: Session, useValue: { current, load, roleHint } },
      { provide: SignInDialog, useValue: { gate } },
      { provide: PLATFORM_ID, useValue: options.platform ?? 'browser' },
    ],
  });
  await TestBed.inject(I18n).enter('public');
  fixture = TestBed.createComponent(BrandChips);
  fixture.componentRef.setInput('brand', options.bar ?? 'bmw');
  fixture.componentRef.setInput('answered', options.answered ?? brand('BMW'));
  if (options.picked) fixture.componentRef.setInput('picked', options.picked);
  picks = [];
  fixture.componentInstance.pick.subscribe(({ key }) => picks.push(key));
  fixture.detectChanges();
}

const host = () => fixture.nativeElement as HTMLElement;
const group = () => host().querySelector<HTMLElement>('fieldset');
const buttons = () => [...host().querySelectorAll<HTMLButtonElement>('button')];
const names = () => buttons().map((b) => b.textContent?.trim());
const marked = () =>
  buttons()
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => b.textContent?.trim());
const tap = (name: string) => {
  const button = buttons().find((b) => b.textContent?.trim() === name);
  button?.focus();
  button?.click();
  fixture.detectChanges();
  return button;
};

// @traces 1355-FR-001
// @traces 1355-FR-003
// @traces 1355-FR-014
// @traces 1355-FR-015
describe('BrandChips', () => {
  describe('for a visitor', () => {
    it('is a labelled group of buttons, the current brand pressed', async () => {
      await chips();
      await settle();

      expect(group()?.getAttribute('aria-label')).toBe('Marca');
      expect(buttons().every((b) => b.type === 'button')).toBe(true);
      expect(names()).toEqual([
        'BMW',
        'Volkswagen',
        'Dacia',
        'Toyota',
        'Mercedes',
        'Skoda',
        'Ford',
        'Tesla',
      ]);
      expect(marked()).toEqual(['BMW']);
      expect(
        buttons().filter((b) => b.getAttribute('aria-pressed') === 'false'),
      ).toHaveLength(7);
    });

    it('reads the 8 popular brands as a public read, and nothing else', async () => {
      await chips();
      await settle();

      expect(popular).toHaveBeenCalledTimes(1);
      const [params, context] = popular.mock.calls[0];
      expect(params).toEqual({ limit: 8 });
      expect(context.get(PUBLIC_READ)).toBe(true);
      expect(cars).not.toHaveBeenCalled();
      expect(load).not.toHaveBeenCalled();
    });

    it('puts a current brand that is not popular first', async () => {
      await chips({ answered: ALFA, bar: 'alfa' });
      await settle();

      expect(names()).toHaveLength(8);
      expect(names()[0]).toBe('Alfa');
      expect(marked()).toEqual(['Alfa']);
    });

    it('marks the chip when the bar names the brand by its id', async () => {
      await chips({ answered: brand('Dacia'), bar: 'id-Dacia' });
      await settle();

      expect(marked()).toEqual(['Dacia']);
    });

    it('emits the tapped brand by its slug and keeps focus on the chip', async () => {
      await chips();
      await settle();

      const button = tap('Dacia');

      expect(picks).toEqual(['dacia']);
      expect(document.activeElement).toBe(button);
    });

    it('emits nothing for the chip already marked', async () => {
      await chips();
      await settle();

      tap('BMW');

      expect(picks).toEqual([]);
    });

    it('reads nothing on the server', async () => {
      await chips({ platform: 'server' });
      await settle();

      expect(popular).not.toHaveBeenCalled();
      expect(names()).toEqual(['BMW']);
    });
  });

  // @traces 1355-FR-012
  // @traces 1355-FR-016
  describe('while the reads are out, or when they fail', () => {
    it('shows the current brand alone, marked, until the popular read answers', async () => {
      let answer: (list: BrandDto[]) => void = () => undefined;
      await chips({
        popular: () => new Promise<BrandDto[]>((r) => (answer = r)),
      });

      expect(names()).toEqual(['BMW']);
      expect(marked()).toEqual(['BMW']);

      answer(POPULAR);
      await settle();

      expect(names()).toHaveLength(8);
    });

    it('leaves the current brand alone, marked, when the popular read fails, and asks nobody to sign in', async () => {
      await chips({
        answered: ALFA,
        bar: 'alfa',
        popular: async () => {
          throw new Error('down');
        },
      });
      await settle();

      expect(names()).toEqual(['Alfa']);
      expect(marked()).toEqual(['Alfa']);
      expect(gate).not.toHaveBeenCalled();
    });

    it('does not rebuild the row for a later session change', async () => {
      await chips();
      await settle();

      current.set({ role: 'driver' });
      roleHint.set('driver');
      await settle();

      expect(cars).not.toHaveBeenCalled();
      expect(names()[0]).toBe('BMW');
    });
  });

  // @traces 1355-FR-002
  // @traces 1355-FR-012
  // @traces 1355-FR-015
  describe("for a driver's own cars", () => {
    it('confirms a remembered driver before reading the cars', async () => {
      await chips({ hint: 'driver' });
      await settle();

      expect(load).toHaveBeenCalledWith({ keepLanguage: true });
      expect(cars).not.toHaveBeenCalled();
    });

    it("leads with the cars' brands in the account's order, each once", async () => {
      await chips({
        answered: ALFA,
        bar: 'alfa',
        cars: async () => ({
          items: [car('Kia'), car('Dacia'), car('Kia')],
        }),
        role: 'driver',
      });
      await settle();

      expect(load).toHaveBeenCalledWith({ keepLanguage: true });
      expect(names()).toEqual([
        'Kia',
        'Dacia',
        'Alfa',
        'BMW',
        'Volkswagen',
        'Toyota',
        'Mercedes',
        'Skoda',
      ]);
    });

    it('emits an own brand by the slug of the same popular brand, and by its id otherwise', async () => {
      await chips({
        cars: async () => ({ items: [car('Kia'), car('Dacia')] }),
        role: 'driver',
      });
      await settle();

      tap('Dacia');
      tap('Kia');

      expect(picks).toEqual(['dacia', 'id-Kia']);
    });

    it('marks an own brand by the answered brand when the bar names its slug', async () => {
      await chips({
        answered: brand('Kia', null),
        bar: 'kia',
        cars: async () => ({ items: [car('Kia')] }),
        role: 'driver',
      });
      await settle();

      expect(marked()).toEqual(['Kia']);
      expect(names().filter((n) => n === 'Kia')).toHaveLength(1);
    });

    it('keeps the popular row when the cars read fails, and asks nobody to sign in', async () => {
      await chips({
        cars: async () => {
          throw new Error('401');
        },
        role: 'driver',
      });
      await settle();

      expect(names()).toHaveLength(8);
      expect(names()[0]).toBe('BMW');
      expect(gate).not.toHaveBeenCalled();
    });

    it('shows the current brand alone when both reads fail', async () => {
      await chips({
        cars: async () => {
          throw new Error('down');
        },
        popular: async () => {
          throw new Error('down');
        },
        role: 'driver',
      });
      await settle();

      expect(names()).toEqual(['BMW']);
      expect(marked()).toEqual(['BMW']);
    });

    it('reads no cars for a garage account', async () => {
      await chips({ role: 'garage' });
      await settle();

      expect(cars).not.toHaveBeenCalled();
    });
  });

  // @traces 1355-FR-010
  describe('a brand picked in the search', () => {
    it('takes the current slot when it is the brand in the bar', async () => {
      await chips({ answered: brand('BMW'), bar: 'alfa', picked: ALFA });
      await settle();

      expect(names()[0]).toBe('Alfa');
      expect(names()).toHaveLength(8);
      expect(marked()).toEqual(['Alfa']);
    });

    it('is marked in place when it is already in the row', async () => {
      await chips({ bar: 'dacia', picked: brand('Dacia') });
      await settle();

      expect(names()[2]).toBe('Dacia');
      expect(marked()).toEqual(['Dacia']);
    });

    it('is dropped once the bar names another brand', async () => {
      await chips({ answered: brand('Dacia'), bar: 'dacia', picked: ALFA });
      await settle();

      expect(names()).not.toContain('Alfa');
    });
  });

  // @traces 1355-FR-013
  describe('on a phone', () => {
    const scrollIntoView = Element.prototype.scrollIntoView;
    afterEach(() => {
      Element.prototype.scrollIntoView = scrollIntoView;
    });

    // A box on the page, as getBoundingClientRect reports it; jsdom lays nothing out.
    const place = (el: Element, left: number, width: number) => {
      el.getBoundingClientRect = () =>
        ({ left, right: left + width, width }) as DOMRect;
    };

    it('scrolls the row to bring the marked chip into view, without scrollIntoView', async () => {
      const into = jest.fn();
      Element.prototype.scrollIntoView = into;
      await chips({ answered: brand('Tesla'), bar: 'tesla' });
      await settle();
      const row = group() as HTMLElement;
      const chip = buttons()[7] as HTMLButtonElement;
      Object.defineProperty(row, 'clientWidth', { value: 300 });
      place(row, 0, 300);
      place(chip, 900, 80);
      Object.defineProperty(chip, 'offsetWidth', { value: 80 });

      fixture.componentRef.setInput('brand', 'ford');
      fixture.componentRef.setInput('answered', brand('Ford'));
      fixture.detectChanges();
      await settle();
      const ford = buttons()[6] as HTMLButtonElement;
      place(ford, 800, 70);
      Object.defineProperty(ford, 'offsetWidth', { value: 70 });
      fixture.componentRef.setInput('brand', 'tesla');
      fixture.componentRef.setInput('answered', brand('Tesla'));
      fixture.detectChanges();
      await settle();

      expect(row.scrollLeft).toBeGreaterThan(0);
      expect(row.scrollLeft + 300).toBeGreaterThanOrEqual(900 + 80);
      expect(into).not.toHaveBeenCalled();
    });

    it('measures the marked chip from the row itself, not from whatever positioned ancestor offsetLeft uses', async () => {
      await chips({ answered: brand('Volkswagen'), bar: 'volkswagen' });
      await settle();
      const row = group() as HTMLElement;
      const chip = buttons()[7] as HTMLButtonElement;
      Object.defineProperty(row, 'clientWidth', { value: 300 });
      place(row, 120, 300);
      // offsetLeft counts from an ancestor left of the row: it says the chip is in view.
      Object.defineProperty(chip, 'offsetLeft', { value: 0 });
      Object.defineProperty(chip, 'offsetWidth', { value: 80 });
      // On the page the chip sits 900 px into the row.
      place(chip, 120 + 900, 80);

      fixture.componentRef.setInput('brand', 'tesla');
      fixture.componentRef.setInput('answered', brand('Tesla'));
      fixture.detectChanges();
      await settle();

      expect(row.scrollLeft + 300).toBeGreaterThanOrEqual(900 + 80);
    });

    it('leaves the row where it is when the marked chip is already in view', async () => {
      await chips();
      await settle();
      const row = group() as HTMLElement;
      Object.defineProperty(row, 'clientWidth', { value: 300 });

      fixture.componentRef.setInput('brand', 'volkswagen');
      fixture.componentRef.setInput('answered', brand('Volkswagen'));
      fixture.detectChanges();
      await settle();

      expect(row.scrollLeft).toBe(0);
    });

    // Chrome scrolls a focused chip only when none of it shows: the last
    // chip, half past the screen's edge, would keep its ring cut off.
    it('brings a chip that takes the focus wholly inside the row, clear of its padding', async () => {
      await chips();
      await settle();
      const row = group() as HTMLElement;
      row.style.padding = '0 16px';
      Object.defineProperty(row, 'clientWidth', { value: 320 });
      place(row, 0, 320);
      row.scrollLeft = 404;
      const last = buttons()[7] as HTMLButtonElement;
      place(last, 290, 88);
      Object.defineProperty(last, 'offsetWidth', { value: 88 });

      last.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

      expect(row.scrollLeft).toBe(404 + 290 + 88 - (320 - 16));
    });

    it("brings a focused chip cut off at the row's start back past its padding", async () => {
      await chips();
      await settle();
      const row = group() as HTMLElement;
      row.style.padding = '0 16px';
      Object.defineProperty(row, 'clientWidth', { value: 320 });
      place(row, 0, 320);
      row.scrollLeft = 200;
      const first = buttons()[1] as HTMLButtonElement;
      place(first, -30, 70);
      Object.defineProperty(first, 'offsetWidth', { value: 70 });

      first.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

      expect(row.scrollLeft).toBe(200 - 30 - 16);
    });

    it('leaves the row where it is when the focused chip shows whole', async () => {
      await chips();
      await settle();
      const row = group() as HTMLElement;
      Object.defineProperty(row, 'clientWidth', { value: 320 });
      place(row, 0, 320);
      row.scrollLeft = 100;
      const chip = buttons()[3] as HTMLButtonElement;
      place(chip, 120, 70);
      Object.defineProperty(chip, 'offsetWidth', { value: 70 });

      chip.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

      expect(row.scrollLeft).toBe(100);
    });
  });
});

describe('the brand chip spacing', () => {
  // The Jest transform drops component styles, so they are read from the source.
  const css = readFileSync(join(__dirname, 'brand-chips.css'), 'utf8').replace(
    /\s+/g,
    ' ',
  );

  it('sets the whole chip padding to 0 16px, leaving no browser default on the block axis', () => {
    const chip = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].find(
      ([, sel]) => sel.trim() === '.chip',
    )?.[2];
    expect(chip).toMatch(/(^|;) ?padding: 0 var\(--mf-space-4\);/);
    expect(chip).not.toContain('padding-inline');
  });
});
