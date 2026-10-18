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
  template: `<mf-estimate-bar [garage]="garage()" />`,
})
class Host {
  readonly garage = signal(GARAGE);
  readonly selection = inject(PriceSelection);
}

let fixture: ComponentFixture<Host>;
let role: ReturnType<typeof signal<MeDto['role'] | null>>;

async function render({
  initial = null as MeDto['role'] | null,
  platform = 'browser',
  language = 'ro' as 'ro' | 'en',
} = {}) {
  role = signal(initial);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: PLATFORM_ID, useValue: platform },
      { provide: Overlays, useValue: { open: jest.fn(async () => undefined) } },
      { provide: Consent, useValue: { track: jest.fn() } },
      {
        provide: Session,
        useValue: {
          current: signal(null),
          load: jest.fn(async () => null),
          renew: jest.fn(async () => true),
          roleHint: role,
        },
      },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: convertToParamMap({}) } },
      },
    ],
  });
  await TestBed.inject(I18n).enter('public');
  await TestBed.inject(I18n).use(language);
  sessionStorage.clear();
  fixture = TestBed.createComponent(Host);
  fixture.componentInstance.selection.sync(GARAGE);
  fixture.detectChanges();
}

const bar = () =>
  (fixture.nativeElement as HTMLElement).querySelector(
    'mf-estimate-bar',
  ) as HTMLElement;
const total = () => bar().querySelector('.total') as HTMLElement | null;
const say = (el: Element | null) =>
  el?.textContent?.replace(/\s+/g, ' ').trim();

function focusIn(el: HTMLElement) {
  document.body.append(el);
  el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  fixture.detectChanges();
}

afterEach(() => {
  TestBed.resetTestingModule();
  document.body.innerHTML = '';
});

// @traces 311-FR-002 311-FR-011
describe('the bar in English', () => {
  it('writes the range with commas and the empty text in English', async () => {
    await render({ language: 'en' });
    expect(say(total())).toBe('Pick the jobs');

    fixture.componentInstance.selection.toggle('j-diag', true);
    fixture.componentInstance.selection.toggle('j-brakes', true);
    fixture.detectChanges();

    expect(say(total())).toBe('1,040–1,620 lei');
    expect(total()?.getAttribute('aria-label')).toBe(
      'Estimate from 1,040 to 1,620 lei',
    );
    expect(say(bar())).toContain('REQUEST A QUOTE');
  });

  it('follows a change of language while open', async () => {
    await render();
    fixture.componentInstance.selection.toggle('j-diag', true);
    fixture.detectChanges();
    await TestBed.inject(I18n).use('en');
    fixture.detectChanges();

    expect(say(total())).toBe('150–220 lei');
    expect(say(bar())).toContain('REQUEST A QUOTE');
  });
});

// @traces 311-FR-001
describe('who the bar is shown to', () => {
  it.each(['garage', 'admin', 'mechanic'] as const)(
    'holds no button for the %s role',
    async (name) => {
      await render({ initial: name as MeDto['role'] });

      expect(bar().querySelector('button')).toBeNull();
    },
  );

  it('appears when a visitor signs in as a driver and goes when a garage signs in', async () => {
    await render();
    role.set('garage');
    fixture.detectChanges();
    expect(bar().querySelector('button')).toBeNull();

    role.set('driver');
    fixture.detectChanges();
    expect(bar().querySelector('button')).not.toBeNull();
  });

  it('leaves the host itself hidden for a garage-side role, so no empty strip stays fixed on the page', async () => {
    await render({ initial: 'garage' });

    expect(bar().hidden).toBe(true);
  });
});

// @traces 311-FR-006
describe('which focus hides the bar', () => {
  it('hides for a textarea, a text input and a contenteditable', async () => {
    await render();
    for (const make of [
      () => document.createElement('textarea'),
      () => document.createElement('input'),
      () => {
        const div = document.createElement('div');
        div.contentEditable = 'true';
        Object.defineProperty(div, 'isContentEditable', { value: true });
        return div;
      },
    ]) {
      focusIn(make());
      expect(bar().hidden).toBe(true);
      document.dispatchEvent(new FocusEvent('focusout'));
      fixture.detectChanges();
      expect(bar().hidden).toBe(false);
    }
  });

  it('stays for a button receiving focus', async () => {
    await render();
    focusIn(document.createElement('button'));

    expect(bar().hidden).toBe(false);
  });

  it('shows again when focus moves from a field to a button', async () => {
    await render();
    focusIn(document.createElement('textarea'));
    document.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    focusIn(document.createElement('button'));

    expect(bar().hidden).toBe(false);
  });
});

// @traces 311-FR-003 311-FR-010
describe('the server render', () => {
  it('shows the silent placeholder and no total button', async () => {
    await render({ platform: 'server' });

    expect(total()?.tagName).not.toBe('BUTTON');
    expect(total()?.getAttribute('aria-hidden')).toBe('true');
    expect(bar().querySelector('[aria-live]')).toBeNull();
  });
});

// @traces 311-FR-002
describe('the bar when the garage’s prices change', () => {
  it('drops a job the latest read no longer lists and recomputes the total', async () => {
    await render();
    const selection = fixture.componentInstance.selection;
    selection.toggle('j-diag', true);
    selection.toggle('j-brakes', true);
    const next = { ...GARAGE, prices: [GARAGE.prices[1]] };
    selection.sync(next);
    fixture.componentInstance.garage.set(next);
    fixture.detectChanges();

    expect(say(total())).toBe('890–1.400 lei');
  });

  it('falls back to the pick text when the last switched-on job is dropped', async () => {
    await render();
    const selection = fixture.componentInstance.selection;
    selection.toggle('j-diag', true);
    const next = { ...GARAGE, prices: [GARAGE.prices[1]] };
    selection.sync(next);
    fixture.componentInstance.garage.set(next);
    fixture.detectChanges();

    expect(say(total())).toBe('Alege lucrările');
  });

  it('shows only the request button once the prices are emptied', async () => {
    await render();
    const next = { ...GARAGE, prices: [] };
    fixture.componentInstance.selection.sync(next);
    fixture.componentInstance.garage.set(next);
    fixture.detectChanges();

    expect(total()).toBeNull();
    expect(bar().querySelectorAll('button')).toHaveLength(1);
  });
});
