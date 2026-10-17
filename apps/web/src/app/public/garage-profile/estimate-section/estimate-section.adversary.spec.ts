import { Component, inject, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import type { PublicGarageDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { EstimateSection } from './estimate-section';
import { Consent } from '../../../consent/consent';
import { Session } from '../../../dashboard/session';
import { PriceSelection } from '../price-selection/price-selection';

const row = (
  jobTypeId: string,
  nameRo: string,
  nameEn: string,
  fromBani: number,
  toBani: number,
) => ({ fromBani, jobTypeId, nameEn, nameRo, toBani });

const DIAGNOSIS = row('j-diag', 'Diagnoză', 'Diagnosis', 15_000, 22_000);
const BRAKES = row('j-brakes', 'Frâne', 'Brakes', 89_000, 140_000);
const CHAIN = row('j-chain', 'Lanț', 'Chain', 4_200_000, 6_800_000);

const base = (id: string, prices: PublicGarageDto['prices']) =>
  ({
    brandNote: null,
    doesNotTake: [],
    id,
    jobTypes: [],
    name: 'Service',
    paymentMethods: { card: false, cash: false, transfer: false },
    photos: [],
    prices,
    rating: null,
    refusalPhrase: null,
    responseRate: { state: 'new' },
    reviewCount: 0,
    slug: id,
    verifiedAt: null,
    worksOn: [],
  }) as PublicGarageDto;

const GARAGE = base('g-1', [DIAGNOSIS, BRAKES, CHAIN]);
const OTHER = base('g-2', [DIAGNOSIS, BRAKES]);

@Component({
  imports: [EstimateSection],
  providers: [PriceSelection],
  template: `<section mf-estimate-section [garage]="garage()"></section>`,
})
class Host {
  readonly garage = signal(GARAGE);
  readonly selection = inject(PriceSelection);
}

let fixture: ComponentFixture<Host>;
let open: jest.Mock;

async function render(
  garage: PublicGarageDto = GARAGE,
  stored?: Record<string, unknown>,
) {
  open = jest.fn(async () => 'cancelled');
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: Overlays, useValue: { open } },
      { provide: Consent, useValue: { track: jest.fn() } },
      {
        provide: Session,
        useValue: {
          current: signal(null),
          load: jest.fn(async () => null),
          renew: jest.fn(async () => true),
          roleHint: signal(null),
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
  for (const [id, value] of Object.entries(stored ?? {}))
    sessionStorage.setItem(`mf.estimate.${id}`, JSON.stringify(value));
  fixture = TestBed.createComponent(Host);
  fixture.componentInstance.garage.set(garage);
  fixture.componentInstance.selection.sync(garage);
  fixture.detectChanges();
}

const box = () =>
  (fixture.nativeElement as HTMLElement).querySelector(
    'section[mf-estimate-section]',
  ) as HTMLElement;
const text = (selector: string) =>
  box().querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();
const names = () =>
  [...box().querySelectorAll('.row .name')].map((n) => n.textContent?.trim());
const cells = () =>
  [...box().querySelectorAll('.totals mf-odometer')].map((o) =>
    [...o.querySelectorAll('.mf-odometer-digit')]
      .map((d) => d.textContent)
      .join(''),
  );
const live = () => [...box().querySelectorAll('[aria-live]')];
const spoken = () => live()[0]?.textContent?.trim();

function toggle(id: string, checked = true) {
  fixture.componentInstance.selection.toggle(id, checked);
  fixture.detectChanges();
}

function reread(garage: PublicGarageDto) {
  fixture.componentInstance.garage.set(garage);
  fixture.componentInstance.selection.sync(garage);
  fixture.detectChanges();
}

async function press() {
  (
    box().querySelector('mf-request-quote-button button') as HTMLButtonElement
  ).click();
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
  }
}

afterEach(() => TestBed.resetTestingModule());

// @traces 356-FR-003 356-FR-004
describe('the totals at the edges', () => {
  it('rounds the sum of the bani, not each row', async () => {
    const half = (id: string) => row(id, id, id, 15_049, 15_049);
    await render(base('g-r', [half('a'), half('b')]));
    toggle('a');
    toggle('b');

    expect(cells()).toEqual(['00301', '00301']);
    expect(box().querySelector('.totals')?.getAttribute('aria-label')).toBe(
      'Estimare de la 301 la 301 lei',
    );
  });

  it('shows less than half a leu as zero lei', async () => {
    await render(base('g-r', [row('a', 'a', 'a', 49, 49)]));
    toggle('a');

    expect(cells()).toEqual(['00000', '00000']);
  });

  it('grows each total on its own across 99.999 lei', async () => {
    await render(base('g-r', [row('a', 'a', 'a', 9_999_900, 10_000_000)]));
    toggle('a');

    expect(cells()).toEqual(['99999', '100000']);
  });

  it('adds a very large total without losing a digit', async () => {
    await render(
      base('g-r', [
        row('a', 'a', 'a', 5_000_000_000, 6_000_000_000),
        row('b', 'b', 'b', 5_000_000_000, 6_000_000_000),
      ]),
    );
    toggle('a');
    toggle('b');

    expect(cells()).toEqual(['100000000', '120000000']);
    expect(box().querySelector('.totals')?.getAttribute('aria-label')).toBe(
      'Estimare de la 100.000.000 la 120.000.000 lei',
    );
  });

  it('adds up all of a long list', async () => {
    const prices = Array.from({ length: 200 }, (_, i) =>
      row(`j-${i}`, `Lucrare ${i}`, `Job ${i}`, 10_000, 20_000),
    );
    await render(base('g-big', prices));
    for (const p of prices) toggle(p.jobTypeId);

    expect(box().querySelectorAll('.row')).toHaveLength(200);
    expect(cells()).toEqual(['20000', '40000']);
  });

  it('shows a free job at zero without breaking the total', async () => {
    await render(base('g-r', [row('a', 'a', 'a', 0, 0), DIAGNOSIS]));
    toggle('a');
    toggle('j-diag');

    expect(cells()).toEqual(['00150', '00220']);
  });

  it('ignores a switch on for a job the list does not carry', async () => {
    await render();
    toggle('j-diag');

    toggle('j-nothing');

    expect(names()).toEqual(['Diagnoză']);
    expect(cells()).toEqual(['00150', '00220']);
  });

  it('lists the jobs in the order of the list however they were switched on', async () => {
    await render();
    toggle('j-chain');
    toggle('j-diag');
    toggle('j-brakes');

    expect(names()).toEqual(['Diagnoză', 'Frâne', 'Lanț']);
  });

  it('shows a job name as plain text', async () => {
    await render(
      base('g-x', [
        row('x', '<img src=x onerror=alert(1)>', '<b>x</b>', 10_000, 20_000),
      ]),
    );
    toggle('x');

    expect(names()).toEqual(['<img src=x onerror=alert(1)>']);
    expect(box().querySelector('.row img, .row b')).toBeNull();
  });

  it('keeps the totals out of assistive technology but for the one sentence', async () => {
    await render();
    toggle('j-diag');

    expect(box().querySelectorAll('.totals [aria-live]')).toHaveLength(0);
    expect(live()).toHaveLength(1);
  });
});

// @traces 356-FR-005 356-FR-010
describe('the live region', () => {
  it('is silent on load even when a selection was restored', async () => {
    await render(GARAGE, { 'g-1': ['j-diag', 'j-brakes'] });

    expect(cells()).toEqual(['01040', '01620']);
    expect(live()).toHaveLength(1);
    expect(spoken()).toBe('');
  });

  it('is silent after a read of the list that drops nothing', async () => {
    await render(GARAGE, { 'g-1': ['j-diag'] });

    reread({ ...GARAGE, prices: [DIAGNOSIS, BRAKES, CHAIN] });

    expect(spoken()).toBe('');
    expect(text('.dropped')).toBeUndefined();
  });

  it('is silent on load when the stored selection holds jobs the list lost', async () => {
    await render(GARAGE, { 'g-1': ['j-diag', 'j-gone'] });

    expect(spoken()).toBe('');
    expect(box().querySelector('.dropped')).toBeNull();
    expect(names()).toEqual(['Diagnoză']);
  });

  it('keeps the message after a second read that changes nothing', async () => {
    await render();
    toggle('j-brakes');
    const gone = { ...GARAGE, prices: [DIAGNOSIS, CHAIN] };
    reread(gone);
    reread({ ...gone });

    expect(spoken()).toBe('O lucrare pornită nu mai este oferită de service.');
    expect(live()).toHaveLength(1);
  });

  it('carries the message, and the empty totals, when the only job on goes', async () => {
    await render();
    toggle('j-brakes');

    reread({ ...GARAGE, prices: [DIAGNOSIS, CHAIN] });

    expect(spoken()).toBe('O lucrare pornită nu mai este oferită de service.');
    expect(cells()).toEqual(['00000', '00000']);
    expect(text('.empty')).toContain('Pornește lucrările');
  });

  it('takes the message away at a switch off, and says the sentence instead', async () => {
    await render();
    toggle('j-brakes');
    toggle('j-chain');
    reread({ ...GARAGE, prices: [DIAGNOSIS, CHAIN] });

    toggle('j-chain', false);

    expect(box().querySelector('.dropped')).toBeNull();
    expect(spoken()).not.toContain('nu mai este oferită');
    expect(live()).toHaveLength(1);
  });

  it('says the message in English', async () => {
    await render();
    toggle('j-brakes');
    reread({ ...GARAGE, prices: [DIAGNOSIS, CHAIN] });
    await TestBed.inject(I18n).use('en');
    fixture.detectChanges();

    expect(spoken()).toBe(
      'A job you switched on is no longer offered by the garage.',
    );
  });

  it('stays silent when only the language changes', async () => {
    await render();
    await TestBed.inject(I18n).use('en');
    fixture.detectChanges();

    expect(spoken()).toBe('');
    expect(live()).toHaveLength(1);
  });

  it('speaks the new language after a switch following a language change', async () => {
    await render();
    await TestBed.inject(I18n).use('en');
    fixture.detectChanges();

    toggle('j-diag');
    toggle('j-brakes');

    expect(spoken()).toBe('Estimate from 1,040 to 1,620 lei');
  });

  it('gives the English empty text when the last job goes off in English', async () => {
    await render();
    await TestBed.inject(I18n).use('en');
    toggle('j-diag');
    toggle('j-diag', false);

    expect(spoken()).toBe(
      'Switch on the jobs you need in the price list and the counter adds them up.',
    );
  });

  it('keeps one atomic polite region through every state', async () => {
    await render();
    for (const step of [
      () => toggle('j-diag'),
      () => toggle('j-brakes'),
      () => reread({ ...GARAGE, prices: [DIAGNOSIS, CHAIN] }),
      () => toggle('j-diag', false),
    ]) {
      step();
      expect(live()).toHaveLength(1);
      expect(live()[0].getAttribute('aria-live')).toBe('polite');
      expect(live()[0].getAttribute('aria-atomic')).toBe('true');
    }
  });
});

// @traces 356-FR-009
describe('a selection kept for the session', () => {
  it('shows nothing on for another garage, and the first back again', async () => {
    await render();
    toggle('j-diag');
    toggle('j-brakes');

    reread(OTHER);
    expect(names()).toEqual([]);
    expect(cells()).toEqual(['00000', '00000']);

    reread(GARAGE);
    expect(names()).toEqual(['Diagnoză', 'Frâne']);
    expect(cells()).toEqual(['01040', '01620']);
  });

  it('counts a job once when the stored list repeats it', async () => {
    await render(GARAGE, { 'g-1': ['j-diag', 'j-diag'] });

    expect(names()).toEqual(['Diagnoză']);
    expect(cells()).toEqual(['00150', '00220']);
  });

  it('shows nothing on and does not fail for a stored value that is not a list', async () => {
    await render(GARAGE, { 'g-1': { 'j-diag': true } });

    expect(names()).toEqual([]);
    expect(cells()).toEqual(['00000', '00000']);
  });

  it('does not fail when the list comes back empty', async () => {
    await render();
    toggle('j-diag');

    reread({ ...GARAGE, prices: [] });

    expect(cells()).toEqual(['00000', '00000']);
    expect(names()).toEqual([]);
  });
});

// @traces 356-FR-011
describe('the hand-over to the request dialog', () => {
  it('hands over an empty list when nothing is on', async () => {
    await render();

    await press();

    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][1].data.jobTypeIds).toEqual([]);
  });

  it('hands over only the jobs that are still listed after a read', async () => {
    await render();
    toggle('j-brakes');
    toggle('j-diag');
    reread({ ...GARAGE, prices: [DIAGNOSIS, CHAIN] });

    await press();

    expect(open.mock.calls[0][1].data.jobTypeIds).toEqual(['j-diag']);
  });

  it('hands over the jobs of the second press, not of the first', async () => {
    await render();
    toggle('j-diag');
    await press();
    toggle('j-chain');

    await press();

    expect([...open.mock.calls[1][1].data.jobTypeIds].sort()).toEqual([
      'j-chain',
      'j-diag',
    ]);
    expect([...open.mock.calls[0][1].data.jobTypeIds]).toEqual(['j-diag']);
  });

  it('leaves the selection as it was after the dialog closes', async () => {
    await render();
    toggle('j-diag');
    toggle('j-brakes');

    await press();

    expect(names()).toEqual(['Diagnoză', 'Frâne']);
    expect(
      JSON.parse(sessionStorage.getItem('mf.estimate.g-1') ?? 'null').sort(),
    ).toEqual(['j-brakes', 'j-diag']);
  });
});
