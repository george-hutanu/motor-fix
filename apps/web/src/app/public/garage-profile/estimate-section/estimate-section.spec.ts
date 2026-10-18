import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
import { estimateTotals } from '../price-selection/totals';

const row = (
  jobTypeId: string,
  nameRo: string,
  nameEn: string,
  fromBani: number,
  toBani: number,
) => ({ fromBani, jobTypeId, nameEn, nameRo, toBani });

const DIAGNOSIS = row(
  'j-diag',
  'Diagnoză și citire coduri de eroare',
  'Diagnosis and fault-code read',
  15_000,
  22_000,
);
const BRAKES = row(
  'j-brakes',
  'Plăcuțe și discuri de frână față',
  'Front brake pads and discs',
  89_000,
  140_000,
);
const BMW_BRAKES = { ...BRAKES, fromBani: 110_000, toBani: 170_000 };
const CHAIN = row(
  'j-chain',
  'Kit lanț de distribuție',
  'Timing chain kit',
  4_200_000,
  6_800_000,
);

const GARAGE: PublicGarageDto = {
  brandNote: null,
  doesNotTake: [],
  id: 'g-1',
  jobTypes: [],
  name: 'Service Auto Militari',
  paymentMethods: { card: false, cash: false, transfer: false },
  photos: [],
  prices: [DIAGNOSIS, BRAKES, CHAIN],
  rating: null,
  refusalPhrase: null,
  responseRate: { state: 'new' },
  reviewCount: 0,
  slug: 'service-auto-militari',
  verifiedAt: null,
  worksOn: [],
};

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

async function render(garage = GARAGE) {
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
const rows = () =>
  [...box().querySelectorAll('.row')].map((r) => [
    r.querySelector('.name')?.textContent?.trim(),
    r.querySelector('.range')?.textContent?.trim(),
  ]);
const cells = () =>
  [...box().querySelectorAll('.totals mf-odometer')].map((o) =>
    [...o.querySelectorAll('.mf-odometer-digit')]
      .map((d) => d.textContent)
      .join(''),
  );
const totals = () => box().querySelector('.totals') as HTMLElement;
const live = () => [...box().querySelectorAll('[aria-live]')];

function toggle(id: string, checked = true) {
  fixture.componentInstance.selection.toggle(id, checked);
  fixture.detectChanges();
}

afterEach(() => TestBed.resetTestingModule());

// @traces 356-FR-001 356-FR-012
describe('the estimate box', () => {
  it('is a region named Estimarea ta, holding its h2 heading', async () => {
    await render();

    expect(box().getAttribute('aria-label')).toBe('Estimarea ta');
    expect(box().querySelector('h2')?.textContent?.trim()).toBe('Estimarea ta');
  });

  it('keeps its texts in the theme tokens that hold contrast in light and dark', () => {
    const css = readFileSync(join(__dirname, 'estimate-section.css'), 'utf8');

    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).toContain('var(--mf-text-secondary)');
  });

  it('writes its small text at body size on a phone and its ranges in fixed-width figures', () => {
    const css = readFileSync(join(__dirname, 'estimate-section.css'), 'utf8');

    expect(css).toMatch(
      /@media \(max-width: 767\.98px\) \{\s*:host \{\s*--mf-size-small: var\(--mf-size-body\);/,
    );
    expect(css).toMatch(/\.range \{[^}]*font-variant-numeric: tabular-nums/);
  });
});

// @traces 356-FR-002 356-FR-003 356-FR-004
describe('the jobs on and their totals', () => {
  it('lists the jobs on, in the order of the list, each with its range', async () => {
    await render();
    toggle('j-brakes');
    toggle('j-diag');

    expect(rows()).toEqual([
      ['Diagnoză și citire coduri de eroare', '150–220 lei'],
      ['Plăcuțe și discuri de frână față', '890–1.400 lei'],
    ]);
  });

  it('adds up the low ends and the high ends in the digit cells', async () => {
    await render();
    toggle('j-diag');
    toggle('j-brakes');

    expect(cells()).toEqual(['01040', '01620']);
    expect(totals().getAttribute('aria-label')).toBe(
      'Estimare de la 1.040 la 1.620 lei',
    );
  });

  it('adds up the range the list carries for the brand in context', async () => {
    await render({ ...GARAGE, prices: [DIAGNOSIS, BMW_BRAKES, CHAIN] });
    toggle('j-diag');
    toggle('j-brakes');

    expect(cells()).toEqual(['01250', '01920']);
  });

  it('drops at once when a job is switched off', async () => {
    await render();
    toggle('j-diag');
    toggle('j-brakes');
    toggle('j-brakes', false);

    expect(rows()).toEqual([
      ['Diagnoză și citire coduri de eroare', '150–220 lei'],
    ]);
    expect(cells()).toEqual(['00150', '00220']);
  });

  it('grows a total to six cells above 99.999 lei', async () => {
    await render({
      ...GARAGE,
      prices: [
        DIAGNOSIS,
        { ...CHAIN, fromBani: 9_000_000, toBani: 12_000_000 },
      ],
    });
    toggle('j-diag');
    toggle('j-chain');

    expect(cells()).toEqual(['90150', '120220']);
  });

  it('labels the totals DE LA and PÂNĂ LA, writes LEI once, and hides the cells from assistive technology', async () => {
    await render();

    expect(totals().getAttribute('role')).toBe('img');
    expect(text('.totals')).toContain('DE LA');
    expect(text('.totals')).toContain('PÂNĂ LA');
    expect(text('.totals')?.match(/LEI/g)).toHaveLength(1);
  });

  it('says it in English, with the English number format', async () => {
    await render();
    toggle('j-diag');
    toggle('j-brakes');
    await TestBed.inject(I18n).use('en');
    fixture.detectChanges();

    expect(box().getAttribute('aria-label')).toBe('Your estimate');
    expect(rows()[1]).toEqual(['Front brake pads and discs', '890–1,400 lei']);
    expect(totals().getAttribute('aria-label')).toBe(
      'Estimate from 1,040 to 1,620 lei',
    );
    expect(text('.totals')).toContain('FROM');
    expect(text('.totals')).toContain('TO');
    expect(text('.note')).toBe(
      'Where you land in the range depends on your car. The garage confirms once it has seen it.',
    );
  });
});

// @traces 356-FR-005 356-FR-006 356-FR-007 356-FR-008
describe('what the box says', () => {
  it('shows zero and how the counter works with nothing on, the button still there', async () => {
    await render();

    expect(rows()).toEqual([]);
    expect(cells()).toEqual(['00000', '00000']);
    expect(text('.empty')).toBe(
      'Pornește lucrările de care ai nevoie în lista de prețuri și contorul le adună.',
    );
    expect(
      box().querySelector('mf-request-quote-button button'),
    ).not.toBeNull();
  });

  it('always shows the note under the button and the mechanic line', async () => {
    await render();
    const note =
      'Unde ajungi în interval depinde de mașină. Service‑ul confirmă după ce o vede.';

    expect(text('.note')).toBe(note);
    expect(text('.mechanic')).toBe('Mecanic: Orice mecanic');
    toggle('j-diag');
    expect(text('.note')).toBe(note);
    expect(
      box().querySelector('.mechanic button, .mechanic select'),
    ).toBeNull();
  });

  it('holds one polite live region, silent on load', async () => {
    await render();

    expect(live()).toHaveLength(1);
    expect(live()[0].getAttribute('aria-live')).toBe('polite');
    expect(live()[0].getAttribute('aria-atomic')).toBe('true');
    expect(live()[0].textContent?.trim()).toBe('');
  });

  it('says the totals as one sentence after a switch change', async () => {
    await render();
    toggle('j-diag');
    toggle('j-brakes');

    expect(live()).toHaveLength(1);
    expect(live()[0].textContent?.trim()).toBe(
      'Estimare de la 1.040 la 1.620 lei',
    );
  });

  it('says the empty text when the last job goes off', async () => {
    await render();
    toggle('j-diag');
    toggle('j-diag', false);

    expect(live()[0].textContent?.trim()).toBe(
      'Pornește lucrările de care ai nevoie în lista de prețuri și contorul le adună.',
    );
  });
});

// @traces 356-FR-010
describe('a job that leaves the list', () => {
  it('shows that a job on is no longer offered, in the one live region, until the next change', async () => {
    await render();
    toggle('j-diag');
    toggle('j-brakes');
    const reread = { ...GARAGE, prices: [DIAGNOSIS, CHAIN] };
    fixture.componentInstance.garage.set(reread);
    fixture.componentInstance.selection.sync(reread);
    fixture.detectChanges();

    expect(rows()).toEqual([
      ['Diagnoză și citire coduri de eroare', '150–220 lei'],
    ]);
    expect(cells()).toEqual(['00150', '00220']);
    expect(live()).toHaveLength(1);
    expect(live()[0].textContent?.trim()).toBe(
      'O lucrare pornită nu mai este oferită de service.',
    );
    // The visible line is hidden from screen readers, so it is said once.
    expect(
      fixture.nativeElement
        .querySelector('p.dropped')
        ?.getAttribute('aria-hidden'),
    ).toBe('true');

    toggle('j-chain');
    expect(live()[0].textContent?.trim()).not.toContain('nu mai este oferită');
  });

  it('keeps a job still listed on and takes its new range', async () => {
    await render();
    toggle('j-brakes');
    const reread = { ...GARAGE, prices: [DIAGNOSIS, BMW_BRAKES, CHAIN] };
    fixture.componentInstance.garage.set(reread);
    fixture.componentInstance.selection.sync(reread);
    fixture.detectChanges();

    expect(rows()).toEqual([
      ['Plăcuțe și discuri de frână față', '1.100–1.700 lei'],
    ]);
    expect(cells()).toEqual(['01100', '01700']);
  });
});

// @traces 356-FR-005 356-FR-011
describe('the box’s request button', () => {
  it('says where the request went in the box’s one live region, until the next switch change', async () => {
    await render();
    toggle('j-diag');
    open.mockImplementation(
      async (
        _task: unknown,
        { data }: { data: { sent: (r: unknown) => void } },
      ) => {
        const sent = {
          id: 'req-1',
          recipients: [
            { garage: { id: 'g-1', name: 'Service Auto Militari', slug: 's' } },
          ],
        };
        data.sent(sent);
        return sent;
      },
    );
    (
      box().querySelector('mf-request-quote-button button') as HTMLElement
    ).click();
    for (let i = 0; i < 4; i++) {
      await new Promise((resolve) => setTimeout(resolve));
      TestBed.tick();
    }
    fixture.detectChanges();

    expect(box().querySelectorAll('[role="status"]')).toHaveLength(0);
    expect(live()).toHaveLength(1);
    expect(live()[0].textContent?.trim()).toBe(
      'Trimis către Service Auto Militari.',
    );
    expect(text('mf-request-quote-button .sent')).toBe(
      'Trimis către Service Auto Militari.',
    );

    toggle('j-brakes');
    expect(live()[0].textContent?.trim()).toBe(
      'Estimare de la 1.040 la 1.620 lei',
    );
  });

  it('is CERE OFERTĂ and hands the jobs on to the request dialog', async () => {
    await render();
    toggle('j-diag');
    toggle('j-brakes');
    const button = box().querySelector(
      'mf-request-quote-button button',
    ) as HTMLButtonElement;

    expect(button.textContent?.trim()).toBe('CERE OFERTĂ');
    button.click();
    for (let i = 0; i < 4; i++) {
      await new Promise((resolve) => setTimeout(resolve));
      TestBed.tick();
    }

    expect(open).toHaveBeenCalledTimes(1);
    expect([...open.mock.calls[0][1].data.jobTypeIds].sort()).toEqual([
      'j-brakes',
      'j-diag',
    ]);
    expect(rows()).toHaveLength(2);
  });
});

// @traces 311-FR-002 311-FR-005
describe('the box in the estimate sheet', () => {
  it('sums the same totals as estimateTotals', async () => {
    await render();
    toggle('j-diag');
    toggle('j-brakes');

    const sums = estimateTotals(GARAGE.prices, new Set(['j-diag', 'j-brakes']));
    expect([sums.fromLei, sums.toLei]).toEqual([1040, 1620]);
    expect(totals().getAttribute('aria-label')).toBe(
      'Estimare de la 1.040 la 1.620 lei',
    );
  });

  it('hides its own heading inside the sheet, whose title names it', () => {
    const css = readFileSync(join(__dirname, 'estimate-section.css'), 'utf8');

    expect(css).toMatch(/:host\(\.sheet\)\s+h2\s*\{\s*display:\s*none;?\s*\}/);
  });
});
