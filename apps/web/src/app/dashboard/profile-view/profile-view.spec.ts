import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import {
  DeferBlockBehavior,
  DeferBlockState,
  TestBed,
} from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import { capabilitiesOf } from '@motor-fix/contracts/capabilities';
import {
  type GarageProfileDto,
  GaragesService,
  type LegalCheckDto,
  type MeDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { filter, Subject } from 'rxjs';

import { ProfileView } from './profile-view';
import { Live } from '../live';
import { Session } from '../session';

const GARAGE = 'garage-1';

const WEEKDAY: string[][] = [['08:00', '19:00']];

const answer = (over: Partial<GarageProfileDto> = {}): GarageProfileDto => ({
  address: 'Str. Atelierului 14, Militari',
  brandNote: null,
  businessKind: 'company',
  closedDays: [],
  courtesyCar: { paid: false },
  doesNotTake: [
    { id: 'dacia', name: 'Dacia', slug: 'dacia' },
    { id: 'lada', name: 'Lada', slug: 'lada' },
  ],
  facilities: ['courtesy_car', 'waiting_area'],
  hours: {
    fri: WEEKDAY,
    mon: WEEKDAY,
    sat: [['09:00', '14:00']],
    sun: [],
    thu: WEEKDAY,
    tue: WEEKDAY,
    wed: WEEKDAY,
  },
  id: GARAGE,
  jobTypes: [],
  name: 'Service Auto Militari',
  paymentMethods: { card: true, cash: true, transfer: false },
  phone: '+40722123456',
  photos: [],
  prices: [],
  rating: null,
  refusalPhrase: null,
  responseRate: { state: 'new' },
  reviewCount: 0,
  slug: 'service-auto-militari',
  storedClosedDays: [],
  verifiedAt: null,
  version: '0',
  worksOn: [
    {
      fuels: ['petrol', 'diesel', 'hybrid'],
      id: 'bmw',
      name: 'BMW',
      slug: 'bmw',
    },
    { fuels: ['diesel'], id: 'audi', name: 'Audi', slug: 'audi' },
  ],
  ...over,
});

const LEGAL: LegalCheckDto = {
  companyName: 'SERVICE AUTO MILITARI SRL',
  documents: {
    canUpload: false,
    dueOn: '2027-06-15',
    graceUntil: null,
    inReview: false,
    refusal: null,
    row: 'valid',
    state: 'due',
  },
  isMobile: false,
  lastCheckedOn: '2026-10-01',
  latestRecheck: null,
  rarActivities: [],
  rows: (['company', 'caen', 'rar', 'documents'] as const).map((kind) => ({
    checkedOn: '2026-10-01',
    detail: null,
    kind,
    missing: [],
    state: 'ok' as const,
  })),
  status: 'approved',
};

const NONE = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};
const OWNER = {
  capabilities: capabilitiesOf('garage', NONE),
  garageAccess: [{ garageId: GARAGE, role: 'owner' }],
  garageId: GARAGE,
} as unknown as MeDto;
const RECEPTIONIST = {
  capabilities: capabilitiesOf('receptionist', NONE),
  garageAccess: [{ garageId: GARAGE, role: 'receptionist' }],
  garageId: GARAGE,
} as unknown as MeDto;
let me = OWNER;

let events: Subject<LiveMessage>;
let resync: Subject<void>;
let read: jest.Mock;
let legal: jest.Mock;
let weekly: jest.Mock;
let navigate: jest.SpyInstance;
// Every GaragesService member the view touches beyond the two reads.
let touched: string[];

async function render(
  load: () => Promise<GarageProfileDto> = async () => answer(),
  language: 'ro' | 'en' = 'ro',
  legalLoad: () => Promise<LegalCheckDto> = async () => LEGAL,
) {
  events = new Subject();
  resync = new Subject();
  read = jest.fn(load);
  legal = jest.fn(legalLoad);
  weekly = jest.fn(async () => ({ weeks: [] }));
  touched = [];
  const reads: Record<string, unknown> = {
    garageProfileControllerRead: read,
    garageWeeklyFigures: weekly,
    legalCheckControllerRead: legal,
  };
  TestBed.configureTestingModule({
    deferBlockBehavior: DeferBlockBehavior.Manual,
    providers: [
      {
        provide: GaragesService,
        useValue: new Proxy(reads, {
          get: (target, name) => {
            // Angular itself probes a provider for its ngOnDestroy hook.
            if (
              typeof name === 'string' &&
              !(name in target) &&
              name !== 'ngOnDestroy'
            ) {
              touched.push(name);
            }
            return target[name as string];
          },
        }),
      },
      { provide: Overlays, useValue: { open: jest.fn() } },
      { provide: Session, useValue: { shown: signal(me) } },
      provideRouter([]),
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
    ],
  });
  navigate = jest
    .spyOn(TestBed.inject(Router), 'navigateByUrl')
    .mockResolvedValue(true);
  const i18n = TestBed.inject(I18n);
  await i18n.enter('garage');
  await i18n.enter('public');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(ProfileView);
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  return { element, fixture, settle };
}

const PUBLIC = 'section[aria-labelledby="mf-profile-public"]';
const LEGAL_PANEL = 'section[aria-labelledby="legal-check-title"]';

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const all = (element: HTMLElement, selector: string) => [
  ...element.querySelectorAll<HTMLElement>(selector),
];
const line = (element: HTMLElement, name: string) =>
  element.querySelector<HTMLElement>(`[data-line="${name}"]`);
const message = (kind: string, id: string): LiveMessage => ({
  at: '2026-10-24T09:00:00.000Z',
  id,
  kind,
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const status = (code: number) =>
  new HttpErrorResponse({ status: code, statusText: String(code) });

afterEach(() => TestBed.resetTestingModule());

// @traces 133-FR-005 133-FR-006 133-FR-012 133-FR-013
describe('Profilul service-ului: the public profile panel', () => {
  it("reads the session garage's profile once into the board's one panel", async () => {
    const { element, settle } = await render();
    await settle();

    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith({ garageId: GARAGE });
    const panels = all(element, PUBLIC);
    expect(panels).toHaveLength(1);
    const heading = element.querySelector(
      `#${panels[0].getAttribute('aria-labelledby')}`,
    );
    expect(heading?.tagName).toBe('H2');
    expect(text(heading)).toBe('Profilul public');
    expect(all(panels[0], 'h3').map(text)).toEqual([
      'Lucrează pe',
      'Nu lucrează pe',
      'Facilități',
    ]);
  });

  it('shows a workshop its name, address, hours and the phone marked private', async () => {
    const { element, settle } = await render();
    await settle();

    expect(text(line(element, 'name'))).toBe('Nume Service Auto Militari');
    expect(text(line(element, 'address'))).toBe(
      'Adresă Str. Atelierului 14, Militari',
    );
    expect(line(element, 'area')).toBeNull();
    expect(text(line(element, 'hours'))).toBe(
      'Program Luni – vineri 08:00 – 19:00 Sâmbătă 09:00 – 14:00 Duminică Închis',
    );
    expect(text(line(element, 'phone'))).toContain('+40722123456');
    expect(text(element.querySelector('[data-phone-tag]'))).toBe(
      'nu apare public',
    );
  });

  it('hides the phone line and its tag when the record has no phone', async () => {
    const { element, settle } = await render(async () =>
      answer({ phone: null }),
    );
    await settle();

    expect(line(element, 'phone')).toBeNull();
    expect(element.querySelector('[data-phone-tag]')).toBeNull();
  });

  it('shows no hours line when the answer carries no usable hours', async () => {
    const { element, settle } = await render(async () => answer({ hours: {} }));
    await settle();

    expect(line(element, 'hours')).toBeNull();
  });

  // @traces 133-FR-006
  it("shows a mobile mechanic's service area and never an address", async () => {
    const { element, settle } = await render(async () =>
      answer({
        address: undefined,
        businessKind: 'mobile',
        serviceRadiusKm: 35,
      }),
    );
    await settle();

    expect(line(element, 'address')).toBeNull();
    expect(text(line(element, 'area'))).toBe('Zonă de lucru: 35 km');
    expect(text(element)).not.toContain('Adresă');
  });

  // @traces 133-FR-006
  it('counts a mobile mechanic with no radius as 20 km', async () => {
    const { element, settle } = await render(async () =>
      answer({
        address: 'Str. Veche 1',
        businessKind: 'mobile',
        serviceRadiusKm: undefined,
      }),
    );
    await settle();

    expect(text(line(element, 'area'))).toBe('Zonă de lucru: 20 km');
    expect(text(element)).not.toContain('Str. Veche 1');
  });

  it('speaks English in English', async () => {
    const { element, settle } = await render(undefined, 'en');
    await settle();

    expect(text(all(element, 'section h2')[0])).toBe('Public profile');
    expect(text(line(element, 'name'))).toBe('Name Service Auto Militari');
    expect(text(element.querySelector('[data-phone-tag]'))).toBe(
      'not shown publicly',
    );
    expect(text(element.querySelector('[data-unmarked]'))).toBe(
      'Unmarked brands count as a refusal: you show last for them and get no requests.',
    );
  });
});

const edits = (element: HTMLElement) =>
  all(element, `${PUBLIC} button[data-edit]`).map((b) => b.dataset['edit']);
const editOf = (element: HTMLElement, group: string) =>
  element.querySelector<HTMLButtonElement>(
    `${PUBLIC} button[data-edit="${group}"]`,
  ) as HTMLButtonElement;

// @traces 1246-FR-011 1246-FR-014
describe('Profilul service-ului: the owner edits in place', () => {
  it('gives the owner an edit control by the hours, named for its group', async () => {
    const { element, settle } = await render();
    await settle();

    expect(edits(element)).toContain('hours');
    const hours = editOf(element, 'hours');
    expect(text(hours)).toBe('Modifică profilul');
    expect(hours.type).toBe('button');
    expect(hours.getAttribute('aria-label')).toBe(
      'Modifică profilul: Program și zile închise',
    );
  });

  it('keeps every edit control quiet, a ghost button rather than a bordered one (design.md)', async () => {
    const { element, settle } = await render();
    await settle();

    const controls = all(element, `${PUBLIC} button[data-edit]`);
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      expect(control.classList).toContain('spartan-button-variant-ghost');
      expect(control.classList).not.toContain(
        'spartan-button-variant-secondary',
      );
    }
  });

  it('keeps the hours control for an owner who never sent her hours', async () => {
    const { element, settle } = await render(async () => answer({ hours: {} }));
    await settle();

    expect(line(element, 'hours')).toBeNull();
    expect(editOf(element, 'hours')).not.toBeNull();
  });

  it('opens the hours dialog with the profile as read, asking nothing on a cancel', async () => {
    const { element, settle } = await render();
    await settle();
    const open = TestBed.inject(Overlays).open as jest.Mock;
    open.mockResolvedValueOnce('cancelled');

    editOf(element, 'hours').click();
    await settle();

    expect(open).toHaveBeenCalledTimes(1);
    const [source, options] = open.mock.calls[0];
    expect(source.name).toBe('ProfileEditDialog');
    expect(options).toEqual({
      confirmDiscard: false,
      data: { garageId: GARAGE, group: 'hours', profile: answer() },
      shape: 'dialog',
      title: 'garage.profile.edit.title.hours',
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(text(line(element, 'hours'))).toContain('Sâmbătă 09:00 – 14:00');
  });

  it('shows the saved answer at once, reading nothing more, and the next one after garage.updated', async () => {
    let current = answer();
    const { element, settle } = await render(async () => current);
    await settle();
    const saved = answer({
      hours: { ...answer().hours, sat: [['10:00', '12:00']] },
      version: '1',
    });
    (TestBed.inject(Overlays).open as jest.Mock).mockResolvedValueOnce(saved);

    editOf(element, 'hours').click();
    await settle();

    expect(read).toHaveBeenCalledTimes(1);
    expect(text(line(element, 'hours'))).toContain('Sâmbătă 10:00 – 12:00');

    current = answer({
      hours: { ...answer().hours, sat: [] },
      name: 'Service Auto Militari Nou',
      version: '2',
    });
    events.next(message('garage.updated', GARAGE));
    await wait(350);
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
    expect(text(line(element, 'name'))).toBe('Nume Service Auto Militari Nou');
    expect(text(line(element, 'hours'))).toContain('Sâmbătă – duminică Închis');
  });

  it('opens the next dialog with the saved stamp', async () => {
    const { element, settle } = await render();
    await settle();
    const open = TestBed.inject(Overlays).open as jest.Mock;
    open.mockResolvedValueOnce(answer({ version: '1' }));

    editOf(element, 'hours').click();
    await settle();
    open.mockResolvedValueOnce('cancelled');
    editOf(element, 'hours').click();
    await settle();

    expect(open.mock.calls[1][1].data.profile.version).toBe('1');
  });

  it('names the control in English', async () => {
    const { element, settle } = await render(undefined, 'en');
    await settle();

    expect(text(editOf(element, 'hours'))).toBe('Edit profile');
    expect(editOf(element, 'hours').getAttribute('aria-label')).toBe(
      'Edit profile: Hours and closed days',
    );
  });
});

// @traces 1246-FR-011 1246-FR-014
describe('Profilul service-ului: the owner edits the name and description', () => {
  it('shows the description under the name, and the texts control after the address', async () => {
    const { element, settle } = await render(async () =>
      answer({ description: 'Diesel german și cutii de viteze.' }),
    );
    await settle();

    expect(text(line(element, 'description'))).toBe(
      'Descriere Diesel german și cutii de viteze.',
    );
    expect(edits(element).slice(0, 2)).toEqual(['texts', 'hours']);
    expect(editOf(element, 'texts').getAttribute('aria-label')).toBe(
      'Modifică profilul: Nume și descriere',
    );
  });

  it('shows no description line while there is none, and keeps the control', async () => {
    const { element, settle } = await render();
    await settle();

    expect(line(element, 'description')).toBeNull();
    expect(editOf(element, 'texts')).not.toBeNull();
  });

  it('opens the texts dialog and shows the saved name at once', async () => {
    const { element, settle } = await render();
    await settle();
    const open = TestBed.inject(Overlays).open as jest.Mock;
    open.mockResolvedValueOnce(
      answer({ description: 'Nou', name: 'Service Militari', version: '1' }),
    );

    editOf(element, 'texts').click();
    await settle();

    expect(open.mock.calls[0][1]).toMatchObject({
      data: { group: 'texts' },
      title: 'garage.profile.edit.title.texts',
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(text(line(element, 'name'))).toBe('Nume Service Militari');
    expect(text(line(element, 'description'))).toBe('Descriere Nou');
  });
});

// @traces 1246-FR-011
describe('Profilul service-ului: the owner edits the phone and the service area', () => {
  it('gives a workshop owner the texts, hours and phone controls, and no service area', async () => {
    const { element, settle } = await render();
    await settle();

    expect(edits(element)).toEqual(['texts', 'hours', 'contact']);
    expect(editOf(element, 'contact').getAttribute('aria-label')).toBe(
      'Modifică profilul: Telefon',
    );
  });

  it('gives a mobile mechanic the service area control by her area', async () => {
    const { element, settle } = await render(async () =>
      answer({
        address: undefined,
        businessKind: 'mobile',
        serviceRadiusKm: 35,
      }),
    );
    await settle();

    expect(edits(element)).toEqual(['area', 'texts', 'hours', 'contact']);
    expect(editOf(element, 'area').getAttribute('aria-label')).toBe(
      'Modifică profilul: Zona de lucru',
    );
  });

  it('keeps the phone control for an owner with no phone stored', async () => {
    const { element, settle } = await render(async () =>
      answer({ phone: null }),
    );
    await settle();

    expect(editOf(element, 'contact')).not.toBeNull();
  });

  it('shows the saved radius at once', async () => {
    const { element, settle } = await render(async () =>
      answer({
        address: undefined,
        businessKind: 'mobile',
        serviceRadiusKm: 35,
      }),
    );
    await settle();
    (TestBed.inject(Overlays).open as jest.Mock).mockResolvedValueOnce(
      answer({
        address: undefined,
        businessKind: 'mobile',
        serviceRadiusKm: 60,
        version: '1',
      }),
    );

    editOf(element, 'area').click();
    await settle();

    expect(read).toHaveBeenCalledTimes(1);
    expect(text(line(element, 'area'))).toBe('Zonă de lucru: 60 km');
  });
});

// @traces 133-FR-007
describe('Profilul service-ului: the brands', () => {
  it('lists the brands taken with green lamps and their fuels, the refused with red lamps, in the answer order', async () => {
    const { element, settle } = await render();
    await settle();

    const works = all(element, '[data-works] li');
    expect(works.map((li) => text(li.querySelector('mf-lamp')))).toEqual([
      'BMW',
      'Audi',
    ]);
    expect(
      works.map((li) =>
        li.querySelector('mf-lamp')?.getAttribute('data-state'),
      ),
    ).toEqual(['green', 'green']);
    expect(works.map((li) => text(li.querySelector('[data-fuels]')))).toEqual([
      'benzină · motorină · hibrid',
      'motorină',
    ]);
    const refuses = all(element, '[data-refuses] li');
    expect(refuses.map((li) => text(li))).toEqual(['Dacia', 'Lada']);
    expect(
      refuses.map((li) =>
        li.querySelector('mf-lamp')?.getAttribute('data-state'),
      ),
    ).toEqual(['red', 'red']);
    for (const dot of all(element, '.mf-lamp-dot')) {
      expect(dot.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('heads both lists and says unmarked brands count as a refusal', async () => {
    const { element, settle } = await render();
    await settle();

    const headings = all(element, 'section h3').map(text);
    expect(headings).toEqual(
      expect.arrayContaining(['Lucrează pe', 'Nu lucrează pe']),
    );
    expect(text(element.querySelector('[data-unmarked]'))).toBe(
      'Mărcile nemarcate contează ca refuz: apari ultimul la ele și nu primești cereri.',
    );
  });

  it('says nothing is chosen under an empty list and keeps the refusal line', async () => {
    const { element, settle } = await render(async () =>
      answer({ doesNotTake: [], worksOn: [] }),
    );
    await settle();

    expect(text(element.querySelector('[data-works]'))).toContain(
      'nimic ales încă',
    );
    expect(text(element.querySelector('[data-refuses]'))).toContain(
      'nimic ales încă',
    );
    expect(element.querySelector('[data-unmarked]')).not.toBeNull();
  });

  it("shows the garage's brand note", async () => {
    const { element, settle } = await render(async () =>
      answer({ brandNote: 'Doar modele după 2010' }),
    );
    await settle();

    expect(text(element.querySelector('[data-brand-note]'))).toBe(
      'Doar modele după 2010',
    );
  });
});

// @traces 133-FR-007
describe('Profilul service-ului: the brand note', () => {
  it('leaves the brand note out while no brand is marked, as the public profile does', async () => {
    const { element, settle } = await render(async () =>
      answer({
        brandNote: 'Doar modele după 2010',
        doesNotTake: [],
        worksOn: [],
      }),
    );
    await settle();

    expect(element.querySelector('[data-brand-note]')).toBeNull();
  });
});

// @traces 133-FR-008
describe('Profilul service-ului: the facilities', () => {
  const rows = (element: HTMLElement) =>
    all(element, '[data-facility]').map((row) => ({
      key: row.dataset['facility'],
      label: text(row),
      lamp: row.querySelector('mf-lamp')?.getAttribute('data-state'),
    }));

  it('shows every facility in catalogue order, the one not offered grey, then the payment line', async () => {
    const { element, settle } = await render();
    await settle();

    expect(rows(element)).toEqual([
      {
        key: 'courtesy_car',
        label: 'Mașină la schimb · gratuit',
        lamp: 'green',
      },
      { key: 'pickup_dropoff', label: 'Preluare și predare: nu', lamp: 'grey' },
      { key: 'waiting_area', label: 'Sală de așteptare', lamp: 'green' },
    ]);
    expect(text(element.querySelector('[data-payment]'))).toBe(
      'Plată: numerar, card',
    );
  });

  it('prices a paid courtesy car per day in whole lei', async () => {
    const { element, settle } = await render(async () =>
      answer({ courtesyCar: { paid: true, pricePerDayBani: 15_000 } }),
    );
    await settle();

    expect(rows(element)[0].label).toBe('Mașină la schimb · 150 lei / zi');
  });

  it('shows the bare label for a paid courtesy car with no price', async () => {
    const { element, settle } = await render(async () =>
      answer({ courtesyCar: { paid: true } }),
    );
    await settle();

    expect(rows(element)[0].label).toBe('Mașină la schimb');
  });

  it('shows all three as not offered and no payment line when none is set', async () => {
    const { element, settle } = await render(async () =>
      answer({
        courtesyCar: undefined,
        facilities: [],
        paymentMethods: { card: false, cash: false, transfer: false },
      }),
    );
    await settle();

    expect(rows(element).map((row) => row.lamp)).toEqual([
      'grey',
      'grey',
      'grey',
    ]);
    expect(rows(element).every((row) => row.label.endsWith(': nu'))).toBe(true);
    expect(element.querySelector('[data-payment]')).toBeNull();
  });

  it('shows the facilities note', async () => {
    const { element, settle } = await render(async () =>
      answer({ facilitiesNote: 'Cafea gratuită' }),
    );
    await settle();

    expect(text(element.querySelector('[data-facilities-note]'))).toBe(
      'Cafea gratuită',
    );
  });
});

// @traces 133-FR-009 133-FR-013
describe('Profilul service-ului: the public profile link', () => {
  it('opens the public profile in the interface language in a new tab', async () => {
    const { element, settle } = await render();
    await settle();

    const link = element.querySelector<HTMLAnchorElement>('[data-public-link]');
    expect(link?.tagName).toBe('A');
    expect(link?.getAttribute('href')).toBe(
      '/ro/garages/service-auto-militari',
    );
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toContain('noopener');
    expect(text(link)).toBe(
      'Vezi profilul public (se deschide într‑o filă nouă)',
    );
  });

  it('links the English profile in English', async () => {
    const { element, settle } = await render(undefined, 'en');
    await settle();

    expect(
      element.querySelector('[data-public-link]')?.getAttribute('href'),
    ).toBe('/en/garages/service-auto-militari');
  });
});

// @traces 133-FR-010
describe('Profilul service-ului: loading, failure and suspension', () => {
  it('shows the skeleton in the panel while the first read is open', async () => {
    let answerNow: (value: GarageProfileDto) => void = () => undefined;
    const { element, settle } = await render(
      () =>
        new Promise((resolve) => {
          answerNow = resolve;
        }),
    );
    await settle();

    expect(
      all(element, 'section [data-skeleton]').length,
    ).toBeGreaterThanOrEqual(3);
    expect(element.querySelector('[data-public-link]')).toBeNull();

    answerNow(answer());
    await settle();
    expect(element.querySelector('[data-skeleton]')).toBeNull();
  });

  it('shows the error and a retry in the panel, and a retry reads once more', async () => {
    let fail = true;
    const { element, settle } = await render(async () => {
      if (fail) throw status(503);
      return answer();
    });
    await settle();

    const errors = all(element, 'section [data-error]');
    expect(errors).toHaveLength(1);
    expect(text(errors[0])).toContain('Nu am putut încărca profilul.');
    const retries = all(element, 'section [data-retry]');
    expect(retries.map(text)).toEqual(['Reîncearcă']);
    expect(element.querySelector('[data-public-link]')).toBeNull();

    fail = false;
    retries[0].click();
    await settle();
    expect(read).toHaveBeenCalledTimes(2);
    expect(element.querySelector('[data-error]')).toBeNull();
    expect(text(line(element, 'name'))).toContain('Service Auto Militari');
  });

  it('says the profile is off the map while the garage is suspended, with no profile panel and no link', async () => {
    const { element, settle } = await render(async () => {
      throw status(410);
    });
    await settle();

    expect(text(element.querySelector('[data-suspended]'))).toBe(
      'Profilul nu apare pe hartă cât timp service‑ul este suspendat.',
    );
    expect(all(element, PUBLIC)).toEqual([]);
    expect(element.querySelector('[data-public-link]')).toBeNull();
  });

  // @traces 133-FR-002
  it.each([403, 404])('moves to the dashboard on a %s answer', async (code) => {
    const { settle } = await render(async () => {
      throw status(code);
    });
    await settle();

    expect(navigate).toHaveBeenCalledWith('/app/garage');
  });
});

// @traces 136-FR-001
// @traces 136-FR-002
// @traces 136-FR-005
// @traces 136-FR-006
// @traces 136-FR-008
// @traces 136-FR-009
describe('Profilul service-ului: the legal check panel', () => {
  it('shows the legal check right after the public profile panel, read once for the session garage', async () => {
    const { element, settle } = await render();
    await settle();

    expect(legal).toHaveBeenCalledTimes(1);
    expect(legal).toHaveBeenCalledWith({ garageId: GARAGE });
    const panels = all(element, 'section[aria-labelledby]').filter(
      (p) => !p.closest('[data-section="funnel"]'),
    );
    expect(panels.map((p) => p.getAttribute('aria-labelledby'))).toEqual([
      'mf-profile-public',
      'legal-check-title',
    ]);
    const host = element.querySelector('mf-garage-legal-check');
    expect(
      host?.previousElementSibling?.previousElementSibling?.matches(PUBLIC),
    ).toBe(true);
    expect(text(element.querySelector('#legal-check-title'))).toBe(
      'Verificare legală',
    );
    expect(all(element, `${LEGAL_PANEL} [data-legal-row]`)).toHaveLength(4);
  });

  it('keeps the profile panel standing when the legal check fails', async () => {
    const { element, settle } = await render(undefined, 'ro', async () => {
      throw status(503);
    });
    await settle();

    expect(text(line(element, 'name'))).toContain('Service Auto Militari');
    expect(all(element, `${PUBLIC} [data-error]`)).toEqual([]);
    expect(all(element, `${LEGAL_PANEL} button`).map(text)).toEqual([
      'Încearcă din nou',
    ]);
  });

  it('keeps the legal check standing when the profile read fails', async () => {
    const { element, settle } = await render(async () => {
      throw status(503);
    });
    await settle();

    expect(all(element, `${PUBLIC} [data-error]`)).toHaveLength(1);
    expect(legal).toHaveBeenCalledTimes(1);
    expect(all(element, `${LEGAL_PANEL} [data-legal-row]`)).toHaveLength(4);
    expect(all(element, `${LEGAL_PANEL} [role="alert"]`)).toEqual([]);
  });

  it('shows nothing for the legal check when it answers 404, and the profile stays', async () => {
    const { element, settle } = await render(undefined, 'ro', async () => {
      throw status(404);
    });
    await settle();

    expect(all(element, LEGAL_PANEL)).toEqual([]);
    expect(all(element, PUBLIC)).toHaveLength(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps the legal check under the suspended line while the garage is suspended', async () => {
    const { element, settle } = await render(
      async () => {
        throw status(410);
      },
      'ro',
      async () => ({ ...LEGAL, status: 'suspended' }),
    );
    await settle();

    const suspendedLine = element.querySelector('[data-suspended]');
    expect(suspendedLine?.tagName).toBe('P');
    const host = element.querySelector('mf-garage-legal-check');
    expect(host?.previousElementSibling).toBe(suspendedLine);
    expect(all(element, LEGAL_PANEL)).toHaveLength(1);
    expect(text(element.querySelector('[data-legal-tag]'))).toBe('Suspendat');
  });

  it('keeps both panels as they were when a change makes both re-reads fail', async () => {
    let fail = false;
    const { element, settle } = await render(
      async () => {
        if (fail) throw status(503);
        return answer();
      },
      'ro',
      async () => {
        if (fail) throw status(503);
        return LEGAL;
      },
    );
    await settle();

    fail = true;
    events.next(message('garage.suspended', GARAGE));
    await wait(350);
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
    expect(legal).toHaveBeenCalledTimes(2);
    expect(element.querySelector('[data-error]')).toBeNull();
    expect(element.querySelector('[role="alert"]')).toBeNull();
    expect(text(line(element, 'name'))).toBe('Nume Service Auto Militari');
    expect(all(element, `${LEGAL_PANEL} [data-legal-row]`)).toHaveLength(4);
  });

  it('calls nothing but the two reads, through first render, live re-reads and a retry', async () => {
    let fail = true;
    const { element, settle } = await render(undefined, 'ro', async () => {
      if (fail) throw status(503);
      return LEGAL;
    });
    await settle();
    fail = false;
    all(element, `${LEGAL_PANEL} button`)[0]?.click();
    await settle();
    events.next(message('garage.suspended', GARAGE));
    events.next(message('document.due', 'cycle-1'));
    await wait(350);
    await settle();

    expect(legal.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(touched).toEqual([]);
    expect(TestBed.inject(Overlays).open).not.toHaveBeenCalled();
  });

  it('does not read the legal check while the profile is still loading', async () => {
    const { element, settle } = await render(
      () => new Promise(() => undefined),
    );
    await settle();

    expect(element.querySelector('mf-garage-legal-check')).toBeNull();
    expect(legal).not.toHaveBeenCalled();
  });

  it.each([403, 404])(
    'never shows the legal check on a %s profile answer',
    async (code) => {
      const { element, settle } = await render(async () => {
        throw status(code);
      });
      await settle();

      expect(navigate).toHaveBeenCalledWith('/app/garage');
      expect(element.querySelector('mf-garage-legal-check')).toBeNull();
      expect(legal).not.toHaveBeenCalled();
    },
  );

  it('speaks English in English', async () => {
    const { element, settle } = await render(undefined, 'en');
    await settle();

    expect(text(element.querySelector('#legal-check-title'))).toBe(
      'Legal check',
    );
  });
});

// @traces 133-FR-011
describe('Profilul service-ului: kept current', () => {
  it.each(['garage.updated', 'facility.removed', 'facility.re_add_decided'])(
    're-reads in place on %s for its garage',
    async (kind) => {
      let current = answer();
      const { element, settle } = await render(async () => current);
      await settle();

      current = answer({ name: 'Service Auto Militari Nou' });
      events.next(message(kind, GARAGE));
      await wait(350);
      await settle();

      expect(read).toHaveBeenCalledTimes(2);
      expect(text(line(element, 'name'))).toBe(
        'Nume Service Auto Militari Nou',
      );
      expect(element.querySelector('[data-skeleton]')).toBeNull();
    },
  );

  it("ignores another garage's changes", async () => {
    const { settle } = await render();
    await settle();

    events.next(message('garage.updated', 'garage-2'));
    await wait(350);
    await settle();

    expect(read).toHaveBeenCalledTimes(1);
  });

  it('keeps the last answer and shows no error when a re-read fails', async () => {
    let fail = false;
    const { element, settle } = await render(async () => {
      if (fail) throw status(503);
      return answer();
    });
    await settle();

    fail = true;
    events.next(message('garage.updated', GARAGE));
    await wait(350);
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
    expect(element.querySelector('[data-error]')).toBeNull();
    expect(text(line(element, 'name'))).toBe('Nume Service Auto Militari');
  });

  it('shows the suspended line when a re-read answers 410', async () => {
    let suspended = false;
    const { element, settle } = await render(async () => {
      if (suspended) throw status(410);
      return answer();
    });
    await settle();

    suspended = true;
    events.next(message('garage.updated', GARAGE));
    await wait(350);
    await settle();

    expect(element.querySelector('[data-suspended]')).not.toBeNull();
    expect(element.querySelector('[data-public-link]')).toBeNull();
  });

  it('shows the suspended line as soon as garage.suspended arrives', async () => {
    let suspended = false;
    const { element, settle } = await render(async () => {
      if (suspended) throw status(410);
      return answer();
    });
    await settle();

    suspended = true;
    events.next(message('garage.suspended', GARAGE));
    await wait(350);
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
    expect(element.querySelector('[data-suspended]')).not.toBeNull();
    expect(element.querySelector('[data-public-link]')).toBeNull();
  });

  it('shows the profile again as soon as garage.restored arrives', async () => {
    let suspended = true;
    const { element, settle } = await render(async () => {
      if (suspended) throw status(410);
      return answer();
    });
    await settle();
    expect(element.querySelector('[data-suspended]')).not.toBeNull();

    suspended = false;
    events.next(message('garage.restored', GARAGE));
    await wait(350);
    await settle();

    expect(element.querySelector('[data-suspended]')).toBeNull();
    expect(text(line(element, 'name'))).toBe('Nume Service Auto Militari');
  });

  it('shows the latest answer when a change lands during a read', async () => {
    const answers = [
      answer(),
      answer({ name: 'Al doilea' }),
      answer({ name: 'Al treilea' }),
    ];
    let calls = 0;
    const { element, settle } = await render(async () => {
      const next = answers[Math.min(calls, 2)];
      calls += 1;
      await wait(50);
      return next;
    });
    await wait(60);
    await settle();

    events.next(message('garage.updated', GARAGE));
    await wait(320);
    events.next(message('garage.updated', GARAGE));
    await wait(800);
    await settle();

    expect(text(line(element, 'name'))).toBe('Nume Al treilea');
  });

  it('re-reads on a resync and announces nothing', async () => {
    const { element, settle } = await render();
    await settle();

    resync.next();
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
    expect(element.querySelector('[aria-live]')).toBeNull();
  });
});

// @traces 133-FR-012
describe('Profilul service-ului: type and alignment on a phone', () => {
  const css = readFileSync(join(__dirname, 'profile-view.css'), 'utf8');
  const phone =
    /@media not all and \(min-width: 768px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ??
    '';

  it('writes the small text at body size on a phone: the fuel lines and the phone tag', () => {
    expect(phone).toMatch(/:host \{\s*--mf-size-small: var\(--mf-size-body\);/);
  });

  it('writes the field labels at body size on a phone', () => {
    expect(phone).toMatch(/\.label \{\s*font-size: var\(--mf-size-body\);/);
  });

  it('keeps the headings above the labels on a phone: the panel title larger, the group titles bold', () => {
    expect(phone).toMatch(/h2 \{\s*font-size: var\(--mf-size-subheading\);/);
    expect(phone).toMatch(
      /h3 \{\s*font-size: var\(--mf-size-body\);\s*font-weight: 600;/,
    );
  });

  it('starts every value box in a row of fields at the same height, whatever its label holds', () => {
    expect(css).toMatch(
      /\.field \{[^}]*grid-row: span 2;[^}]*grid-template-rows: subgrid;/,
    );
    expect(css).toMatch(/\.field > \.value:only-child \{\s*grid-row: 2;/);
  });

  it("lines the public link's text up with the panel's other lines, its padding and border pulled out", () => {
    expect(css).toMatch(
      /\.public-link \{[^}]*margin-inline-start: calc\(-1 \* var\(--mf-space-5\) - 1px\)/,
    );
  });
});

// @traces 102-FR-006
describe('Profilul service-ului for the receptionist', () => {
  afterEach(() => {
    me = OWNER;
    TestBed.resetTestingModule();
  });

  it('shows her the profile as the owner reads it, with no legal check and no action button', async () => {
    me = RECEPTIONIST;
    const { element, settle } = await render();
    await settle();

    expect(read).toHaveBeenCalledWith({ garageId: GARAGE });
    expect(text(line(element, 'name'))).toContain('Service Auto Militari');
    expect(element.querySelector('mf-garage-legal-check')).toBeNull();
    expect(legal).not.toHaveBeenCalled();
    const buttons = all(element, 'button').map(text);
    expect(buttons).not.toContain('Modifică profilul');
    expect(buttons).not.toContain('Răspunde');
    expect(buttons).toEqual([]);
  });
});

// @traces 1397-FR-006 1397-FR-012
describe('Profilul service-ului: the weekly figures', () => {
  const PANEL = 'mf-weekly-figures-panel';
  const follows = (first: Element | null, then: Element | null) =>
    !!first &&
    !!then &&
    !!(first.compareDocumentPosition(then) & Node.DOCUMENT_POSITION_FOLLOWING);

  afterEach(() => {
    me = OWNER;
  });

  async function completed() {
    const rendered = await render();
    await rendered.settle();
    const blocks = await rendered.fixture.getDeferBlocks();
    expect(blocks).toHaveLength(1);
    await blocks[0].render(DeferBlockState.Complete);
    await rendered.settle();
    return rendered;
  }

  it('puts the panel after the public profile and before the legal check', async () => {
    const { element } = await completed();
    const panel = element.querySelector(PANEL);

    expect(panel).not.toBeNull();
    expect(panel?.getAttribute('data-section')).toBe('funnel');
    expect(panel?.querySelector('h2')?.textContent?.trim()).toBe(
      'De la profil la cerere, pe săptămâni',
    );
    expect(panel?.querySelector('h2 a')).toBeNull();
    expect(follows(element.querySelector(PUBLIC), panel)).toBe(true);
    expect(follows(panel, element.querySelector('mf-garage-legal-check'))).toBe(
      true,
    );
    expect(weekly).toHaveBeenCalledWith({ garageId: GARAGE });
  });

  it('shows the receptionist the panel too', async () => {
    me = RECEPTIONIST;
    const { element } = await completed();

    expect(element.querySelector(PANEL)).not.toBeNull();
    expect(weekly).toHaveBeenCalledWith({ garageId: GARAGE });
  });

  it('holds the place with the titled skeleton until the panel loads', async () => {
    const { element, fixture, settle } = await render();
    await settle();
    const [block] = await fixture.getDeferBlocks();
    await block.render(DeferBlockState.Placeholder);
    const shown = element.querySelector('[data-section="funnel"]');

    expect(shown?.tagName.toLowerCase()).toBe('section');
    expect(text(shown?.querySelector('h2'))).toBe(
      'De la profil la cerere, pe săptămâni',
    );
    expect(shown?.querySelector('[data-chart-skeleton]')).not.toBeNull();
    expect(weekly).not.toHaveBeenCalled();
  });

  it('shows a suspended garage no panel and reads no figures', async () => {
    const { element, fixture, settle } = await render(async () => {
      throw status(410);
    });
    await settle();

    expect(element.querySelector('[data-suspended]')).not.toBeNull();
    expect(element.querySelector('mf-garage-legal-check')).not.toBeNull();
    expect(await fixture.getDeferBlocks()).toHaveLength(0);
    expect(element.querySelector('[data-section="funnel"]')).toBeNull();
    expect(weekly).not.toHaveBeenCalled();
  });
});
