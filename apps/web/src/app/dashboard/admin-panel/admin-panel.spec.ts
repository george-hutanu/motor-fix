// @traces 879-FR-019
import { HttpErrorResponse } from '@angular/common/http';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import { AdminService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { filter, Subject } from 'rxjs';

import { AdminPanel } from './admin-panel';
import { AdminOverview } from '../admin-overview';
import { Live } from '../live';

@Component({ imports: [AdminPanel], template: '<mf-admin-panel />' })
class Host {}

interface Answer {
  garagesWaiting: number;
  garagesListed: number;
  garagesApprovedThisMonth: number;
  activeDrivers: number;
  activeDriversMonthStart?: number;
  observabilityUrl?: string;
}

const FIGURES: Answer = {
  activeDrivers: 12480,
  activeDriversMonthStart: 12168,
  garagesApprovedThisMonth: 9,
  garagesListed: 214,
  garagesWaiting: 2,
};

const LISTED = 'Service‑uri listate';
const RO_LABELS = [
  LISTED,
  'Cereri de ofertă azi',
  'Rată de răspuns',
  'Programări',
  'Șoferi activi',
  'Recenzii raportate',
];

let resync: Subject<void>;
let answer: () => Promise<Answer>;
const NO_MONTHS = async () => ({ months: [] });
let growth: () => Promise<{ months: unknown[] }> = NO_MONTHS;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(language: 'ro' | 'en' = 'ro') {
  const events = new Subject<LiveMessage>();
  resync = new Subject();
  TestBed.configureTestingModule({
    providers: [
      AdminOverview,
      {
        provide: Live,
        useValue: {
          events,
          on: (kinds: readonly EventKind[]) =>
            events.pipe(
              filter((m) => (kinds as readonly string[]).includes(m.kind)),
            ),
          resync,
        },
      },
      {
        provide: AdminService,
        useValue: {
          adminOverviewControllerGrowth: () => growth(),
          adminOverviewControllerOverview: () => answer(),
        },
      },
    ],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(Host);
  await settle();
  return fixture.nativeElement as HTMLElement;
}

const tiles = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLElement>('mf-admin-panel [role="group"]'),
];
const tile = (element: HTMLElement, label: string) =>
  tiles(element).find(
    (t) => t.querySelector('.label')?.textContent?.trim() === label,
  ) as HTMLElement;
const text = (t: HTMLElement, part: 'number' | 'line') =>
  t.querySelector(`.${part}`)?.textContent?.trim();

afterEach(() => {
  TestBed.resetTestingModule();
  growth = NO_MONTHS;
});

const GRAFANA = 'https://stack.grafana.net/d/motorfix-overview?var-env=test';
const link = (element: HTMLElement) =>
  element.querySelector<HTMLAnchorElement>('mf-admin-panel a.observability');

describe('AdminPanel', () => {
  // @traces 163-FR-010
  it('stays busy until the growth read has answered too', async () => {
    let done: (value: { months: unknown[] }) => void = () => undefined;
    growth = () => new Promise((resolve) => (done = resolve));
    answer = async () => FIGURES;
    const element = await open();
    const panel = element.querySelector('mf-admin-panel') as HTMLElement;

    expect(text(tile(element, LISTED), 'number')).toBe('214');
    expect(panel.getAttribute('aria-busy')).toBe('true');

    done({ months: [] });
    await settle();
    expect(panel.getAttribute('aria-busy')).toBeNull();
  });

  it('links to the observability dashboards in a new tab, between the tiles and the growth panel', async () => {
    answer = async () => ({ ...FIGURES, observabilityUrl: GRAFANA });
    const element = await open();

    const anchor = link(element) as HTMLAnchorElement;
    expect(anchor.getAttribute('href')).toBe(GRAFANA);
    expect(anchor.getAttribute('target')).toBe('_blank');
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer');
    expect(anchor.textContent?.trim()).toBe('Observabilitate');
    expect(anchor.getAttribute('aria-label')).toBe(
      'Observabilitate, se deschide într‑o filă nouă',
    );
    const last = tiles(element).at(-1) as HTMLElement;
    const growth = element.querySelector('mf-admin-growth') as Node;
    expect(
      last.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      anchor.compareDocumentPosition(growth) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('names the observability link in English', async () => {
    answer = async () => ({ ...FIGURES, observabilityUrl: GRAFANA });
    const element = await open('en');

    const anchor = link(element) as HTMLAnchorElement;
    expect(anchor.textContent?.trim()).toBe('Observability');
    expect(anchor.getAttribute('aria-label')).toBe(
      'Observability, opens in a new tab',
    );
  });

  it('shows no observability link when the answer carries none', async () => {
    answer = async () => FIGURES;
    const element = await open();

    expect(link(element)).toBeNull();
  });

  it('shows no observability link while the figures load or after they fail', async () => {
    answer = () => new Promise(() => undefined);
    expect(link(await open())).toBeNull();
  });

  it('places the growth panel under the six tiles, leaving the tiles as they were', async () => {
    answer = async () => FIGURES;
    const element = await open();

    const panel = element.querySelector('mf-admin-panel') as HTMLElement;
    const growth = panel.querySelector('mf-admin-growth');
    expect(growth).not.toBeNull();
    expect(tiles(element)).toHaveLength(6);
    expect(growth?.querySelector('[role="group"]')).toBeNull();
    const last = tiles(element).at(-1) as HTMLElement;
    expect(
      last.compareDocumentPosition(growth as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('shows the six tiles in the launch order', async () => {
    answer = async () => FIGURES;
    const element = await open();

    expect(
      tiles(element).map((t) => t.querySelector('.label')?.textContent?.trim()),
    ).toEqual(RO_LABELS);
  });

  it('shows the garages listed with the month’s approvals', async () => {
    answer = async () => FIGURES;
    const element = await open();

    const garages = tile(element, LISTED);
    expect(text(garages, 'number')).toBe('214');
    expect(text(garages, 'line')).toBe('+9 luna asta');
    expect(garages.getAttribute('aria-label')).toBe(
      `${LISTED}, 214, +9 luna asta`,
    );
  });

  it('shows the active drivers grouped in Romanian, with the change since the 1st', async () => {
    answer = async () => FIGURES;
    const element = await open();

    const drivers = tile(element, 'Șoferi activi');
    expect(text(drivers, 'number')).toBe('12.480');
    expect(text(drivers, 'line')).toBe('+312 luna asta');
    expect(drivers.getAttribute('aria-label')).toBe(
      'Șoferi activi, 12.480, +312 luna asta',
    );
  });

  it('writes a fall since the 1st with a minus sign', async () => {
    answer = async () => ({ ...FIGURES, activeDrivers: 12156 });
    const element = await open();

    expect(text(tile(element, 'Șoferi activi'), 'line')).toBe('−12 luna asta');
  });

  it('writes no change as +0', async () => {
    answer = async () => ({
      ...FIGURES,
      activeDrivers: 12168,
      garagesApprovedThisMonth: 0,
      garagesListed: 0,
    });
    const element = await open();

    expect(text(tile(element, LISTED), 'number')).toBe('0');
    expect(text(tile(element, LISTED), 'line')).toBe('+0 luna asta');
    expect(text(tile(element, 'Șoferi activi'), 'line')).toBe('+0 luna asta');
  });

  it('shows the active drivers with no line when the 1st of the month has no snapshot', async () => {
    const { activeDriversMonthStart: _, ...rest } = FIGURES;
    answer = async () => rest;
    const element = await open();

    const drivers = tile(element, 'Șoferi activi');
    expect(text(drivers, 'number')).toBe('12.480');
    expect(drivers.querySelector('.line')).toBeNull();
    expect(drivers.getAttribute('aria-label')).toBe('Șoferi activi, 12.480');
  });

  it('reads in English with English grouping', async () => {
    answer = async () => FIGURES;
    const element = await open('en');

    expect(
      tiles(element).map((t) => t.querySelector('.label')?.textContent?.trim()),
    ).toEqual([
      'Garages listed',
      'Quote requests today',
      'Answer rate',
      'Bookings',
      'Active drivers',
      'Reported reviews',
    ]);
    const drivers = tile(element, 'Active drivers');
    expect(text(drivers, 'number')).toBe('12,480');
    expect(text(drivers, 'line')).toBe('+312 this month');
    expect(text(tile(element, 'Garages listed'), 'line')).toBe('+9 this month');
    expect(text(tile(element, 'Bookings'), 'line')).toBe('coming soon');
  });

  it.each([
    'Cereri de ofertă azi',
    'Rată de răspuns',
    'Programări',
    'Recenzii raportate',
  ])('shows %s as coming soon, with a dash and no number', async (label) => {
    answer = async () => FIGURES;
    const element = await open();

    const soon = tile(element, label);
    expect(text(soon, 'number')).toBe('—');
    expect(text(soon, 'line')).toBe('în curând');
    expect(soon.getAttribute('aria-label')).toBe(`${label}, în curând`);
  });

  it('shows skeletons on the two computed tiles while the first read is on its way, and the coming-soon tiles as they are', async () => {
    answer = () => new Promise(() => undefined);
    const element = await open();

    for (const label of [LISTED, 'Șoferi activi']) {
      const busy = tile(element, label);
      expect(busy.getAttribute('aria-busy')).toBe('true');
      expect(busy.getAttribute('aria-label')).toBe(label);
      expect(busy.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
      expect(text(busy, 'number')).not.toMatch(/\d/);
    }
    expect(text(tile(element, 'Programări'), 'line')).toBe('în curând');
    expect(tile(element, 'Programări').getAttribute('aria-busy')).not.toBe(
      'true',
    );
  });

  it('shows a dash and the reason on both computed tiles when the read fails, never 0', async () => {
    answer = async () => {
      throw new HttpErrorResponse({ status: 503 });
    };
    const element = await open();

    for (const label of [LISTED, 'Șoferi activi']) {
      const failed = tile(element, label);
      expect(text(failed, 'number')).toBe('—');
      expect(failed.textContent).toContain('Cifrele nu au putut fi citite');
      expect(failed.getAttribute('aria-label')).toBe(
        `${label}, —, Cifrele nu au putut fi citite`,
      );
      expect(failed.getAttribute('aria-busy')).not.toBe('true');
    }
    expect(text(tile(element, 'Recenzii raportate'), 'line')).toBe('în curând');
  });

  it('drops the numbers it showed when a re-read fails, and fills them in on the next success', async () => {
    answer = async () => FIGURES;
    const element = await open();
    expect(text(tile(element, LISTED), 'number')).toBe('214');

    answer = async () => {
      throw new HttpErrorResponse({ status: 0 });
    };
    resync.next();
    await settle();
    expect(text(tile(element, LISTED), 'number')).toBe('—');
    expect(text(tile(element, 'Șoferi activi'), 'number')).toBe('—');

    answer = async () => ({ ...FIGURES, garagesListed: 215 });
    resync.next();
    await settle();
    expect(text(tile(element, LISTED), 'number')).toBe('215');
    expect(tile(element, LISTED).textContent).not.toContain(
      'Cifrele nu au putut fi citite',
    );
  });

  it('opens the reason of a failed tile by focus or tap, not by hover only', async () => {
    answer = async () => {
      throw new HttpErrorResponse({ status: 503 });
    };
    const element = await open();

    const tip = tile(element, LISTED).querySelector<HTMLButtonElement>(
      'button',
    ) as HTMLButtonElement;
    expect(tip).not.toBeNull();
    expect(tip.getAttribute('aria-expanded')).toBe('false');

    tip.click();
    await settle();

    expect(tip.getAttribute('aria-expanded')).toBe('true');
  });

  it('ties each failed tile’s reason to its button for assistive tech', async () => {
    answer = async () => {
      throw new HttpErrorResponse({ status: 503 });
    };
    const element = await open();

    const buttons = Array.from(
      element.querySelectorAll<HTMLButtonElement>('[role="group"] button'),
    );
    expect(buttons).toHaveLength(2);
    const ids = buttons.map((b) => b.getAttribute('aria-describedby'));
    expect(new Set(ids).size).toBe(2);
    for (const [i, id] of ids.entries()) {
      const described = element.querySelector(`#${id}`);
      expect(described?.getAttribute('role')).toBe('tooltip');
      expect(described?.closest('[role="group"]')).toBe(
        buttons[i]?.closest('[role="group"]'),
      );
    }
  });

  it('switches labels, lines and grouping to English without a reload', async () => {
    answer = async () => FIGURES;
    const element = await open();
    expect(text(tile(element, 'Șoferi activi'), 'number')).toBe('12.480');

    await TestBed.inject(I18n).use('en');
    await settle();

    const drivers = tile(element, 'Active drivers');
    expect(text(drivers, 'number')).toBe('12,480');
    expect(text(drivers, 'line')).toBe('+312 this month');
    expect(drivers.getAttribute('aria-label')).toBe(
      'Active drivers, 12,480, +312 this month',
    );
    expect(text(tile(element, 'Reported reviews'), 'line')).toBe('coming soon');
  });
});
