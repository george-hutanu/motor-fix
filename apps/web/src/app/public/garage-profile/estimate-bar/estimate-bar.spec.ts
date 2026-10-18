import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Component, inject, PLATFORM_ID, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import type { MeDto, PublicGarageDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { EstimateBar } from './estimate-bar';
import { Consent } from '../../../consent/consent';
import { Session } from '../../../dashboard/session';
import { EstimateSheet } from '../estimate-sheet/estimate-sheet';
import { PriceSelection } from '../price-selection/price-selection';

const row = (jobTypeId: string, nameRo: string, from: number, to: number) => ({
  fromBani: from,
  jobTypeId,
  nameEn: nameRo,
  nameRo,
  toBani: to,
});

const GARAGE: PublicGarageDto = {
  brandNote: null,
  doesNotTake: [],
  id: 'g-1',
  jobTypes: [],
  name: 'Service Auto Militari',
  paymentMethods: { card: false, cash: false, transfer: false },
  photos: [],
  prices: [
    row('j-diag', 'Diagnoză', 15_000, 22_000),
    row('j-brakes', 'Frâne față', 89_000, 140_000),
  ],
  rating: null,
  refusalPhrase: null,
  responseRate: { state: 'new' },
  reviewCount: 0,
  slug: 'service-auto-militari',
  verifiedAt: null,
  worksOn: [],
};

@Component({
  imports: [EstimateBar],
  providers: [PriceSelection],
  template: `@if (on()) { <mf-estimate-bar [garage]="garage()" /> }`,
})
class Host {
  readonly garage = signal(GARAGE);
  readonly on = signal(true);
  readonly selection = inject(PriceSelection);
}

let fixture: ComponentFixture<Host>;
let open: jest.Mock;

async function render({
  garage = GARAGE,
  role = null as MeDto['role'] | null,
  platform = 'browser',
  sync = true,
} = {}) {
  open = jest.fn(async () => undefined);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: PLATFORM_ID, useValue: platform },
      { provide: Overlays, useValue: { open } },
      { provide: Consent, useValue: { track: jest.fn() } },
      {
        provide: Session,
        useValue: {
          current: signal(role === null ? null : { role }),
          load: jest.fn(async () => null),
          renew: jest.fn(async () => true),
          roleHint: signal(role),
        },
      },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: convertToParamMap({}) } },
      },
    ],
  });
  await TestBed.inject(I18n).enter('public');
  await TestBed.inject(I18n).use('ro');
  sessionStorage.clear();
  fixture = TestBed.createComponent(Host);
  fixture.componentInstance.garage.set(garage);
  if (sync) fixture.componentInstance.selection.sync(garage);
  fixture.detectChanges();
}

const bar = () =>
  (fixture.nativeElement as HTMLElement).querySelector(
    'mf-estimate-bar',
  ) as HTMLElement;
const total = () => bar().querySelector('.total') as HTMLButtonElement;
const request = () =>
  bar().querySelector('mf-request-quote-button button') as HTMLButtonElement;
const say = (el: Element | null) =>
  el?.textContent?.replace(/\s+/g, ' ').trim();

function toggle(id: string, checked = true) {
  fixture.componentInstance.selection.toggle(id, checked);
  fixture.detectChanges();
}

afterEach(() => TestBed.resetTestingModule());

// @traces 311-FR-007 311-FR-008
describe('the bar’s stylesheet', () => {
  const css = readFileSync(join(__dirname, 'estimate-bar.css'), 'utf8');

  it('sits fixed on the tab bar and the consent bar', () => {
    expect(css).toMatch(/position:\s*fixed/);
    expect(css).toContain(
      'bottom: calc(var(--tab-bar, 0px) + var(--consent-bar, 0px))',
    );
    expect(css).toMatch(/z-index:\s*10;/);
  });

  it('is gone from 768 px and while hidden', () => {
    expect(css).toMatch(
      /@media \(min-width: 768px\)\s*\{\s*:host\s*\{\s*display:\s*none;?\s*\}/,
    );
    expect(css).toMatch(/:host\(\[hidden\]\)\s*\{\s*display:\s*none;?\s*\}/);
  });

  it('keeps clear of the home indicator where no tab bar is shown', () => {
    expect(css).toMatch(
      /:host-context\(\.no-tab-bar\)\s*\{[^}]*padding-bottom:\s*max\(16px, var\(--mf-safe-bottom\)\)/,
    );
  });

  it('has tap-sized buttons, readable text, steady digits and a plain fallback', () => {
    expect(css).toContain('min-height: var(--mf-tap)');
    expect(css).toContain('var(--mf-size-small)');
    expect(css).toContain('tabular-nums');
    expect(css).toContain('prefers-reduced-transparency: reduce');
  });
});

// @traces 311-FR-001 311-FR-002 311-FR-003 311-FR-004 311-FR-010
describe('what the bar shows', () => {
  it('holds a silent placeholder until the kept jobs are applied', async () => {
    await render({ sync: false });

    expect(total().tagName).not.toBe('BUTTON');
    expect(total().getAttribute('aria-hidden')).toBe('true');
    expect(say(total())).not.toContain('Alege');
  });

  it('asks to pick the jobs with nothing on', async () => {
    await render();

    expect(total().tagName).toBe('BUTTON');
    expect(say(total())).toBe('Alege lucrările');
  });

  it('shows the range of the jobs on, spoken in words', async () => {
    await render();
    toggle('j-diag');
    toggle('j-brakes');

    expect(say(total())).toBe('1.040–1.620 lei');
    expect(total().getAttribute('aria-label')).toBe(
      'Estimare de la 1.040 la 1.620 lei',
    );
    expect(bar().querySelector('[aria-live]')).toBeNull();
  });

  it('puts the total before CERE OFERTĂ, which carries the jobs on', async () => {
    await render();
    toggle('j-brakes');
    const buttons = [...bar().querySelectorAll('button')];

    expect(buttons.indexOf(total())).toBeLessThan(buttons.indexOf(request()));
    expect(say(request())).toBe('CERE OFERTĂ');
  });

  it('shows the request button alone when the garage lists no public job', async () => {
    await render({ garage: { ...GARAGE, prices: [] } });

    expect(total()).toBeNull();
    expect(request()).not.toBeNull();
  });

  it('keeps the refused brand’s disabled button and its reason', async () => {
    await render({
      garage: {
        ...GARAGE,
        brand: {
          id: 'b-1',
          name: 'Dacia',
          slug: 'dacia',
          stance: 'does_not_take',
        },
      },
    });

    expect(request().disabled).toBe(true);
    expect(say(bar())).toContain('Nu lucrează pe Dacia');
    const note = request().getAttribute('aria-describedby') ?? '';
    expect(note).toMatch(/-bar$/);
    expect(bar().querySelector(`#${note}`)?.classList).toContain('note');
  });

  it('shows nothing in a garage-side role', async () => {
    await render({ role: 'garage' });

    expect(bar().querySelector('button')).toBeNull();
  });

  it('shows to a driver', async () => {
    await render({ role: 'driver' });

    expect(request()).not.toBeNull();
  });
});

// @traces 311-FR-006
describe('the bar while typing', () => {
  it('steps aside while a text field has focus and returns on blur', async () => {
    await render();
    const field = document.createElement('input');
    document.body.append(field);

    field.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    fixture.detectChanges();
    expect(bar().hidden).toBe(true);

    field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    fixture.detectChanges();
    expect(bar().hidden).toBe(false);
    field.remove();
  });

  it('stays for a switch, which is not typing', async () => {
    await render();
    const box = document.createElement('input');
    box.type = 'checkbox';
    document.body.append(box);

    box.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    fixture.detectChanges();
    expect(bar().hidden).toBe(false);
    box.remove();
  });
});

// @traces 311-FR-007
describe('the room the bar takes', () => {
  let observed: ((entries: { contentRect: { height: number } }[]) => void)[];
  const original = globalThis.ResizeObserver;
  const height = () =>
    document.documentElement.style.getPropertyValue('--estimate-bar');

  beforeEach(() => {
    observed = [];
    globalThis.ResizeObserver = class {
      constructor(
        callback: (entries: { contentRect: { height: number } }[]) => void,
      ) {
        observed.push(callback);
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;
  });
  afterEach(() => {
    globalThis.ResizeObserver = original;
    document.documentElement.style.removeProperty('--estimate-bar');
  });

  it('gives the page its height as --estimate-bar and takes it back on leaving', async () => {
    await render();
    for (const callback of observed)
      callback([{ contentRect: { height: 71.2 } }]);
    expect(height()).toBe('72px');

    fixture.componentInstance.on.set(false);
    fixture.detectChanges();
    expect(height()).toBe('');
  });

  it('writes nothing on the server', async () => {
    await render({ platform: 'server' });

    expect(observed).toEqual([]);
  });
});

// @traces 311-FR-005
describe('the estimate sheet', () => {
  it('opens from the total with the page’s own selection', async () => {
    await render();
    toggle('j-diag');
    total().click();

    expect(open).toHaveBeenCalledWith(EstimateSheet, {
      data: {
        garage: expect.any(Function),
        selection: fixture.componentInstance.selection,
      },
      shape: 'dialog',
      title: 'public.garageProfile.estimate.title',
    });
    expect(open.mock.calls[0][1].data.garage()).toBe(GARAGE);
  });

  it('opens from "Alege lucrările" too', async () => {
    await render();
    total().click();

    expect(open).toHaveBeenCalledTimes(1);
  });
});
