import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  GaragesService,
  type MeDto,
  type PriceListDto,
  type PriceListItemDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { filter, Subject } from 'rxjs';

import { JobPicker } from './job-picker/job-picker';
import { PriceRangeEditor } from './price-range-editor/price-range-editor';
import { PricesView } from './prices-view';
import { RemoveJob } from './remove-job/remove-job';
import { Live } from '../live';
import { Session } from '../session';

const GARAGE = 'garage-1';

const item = (over: Partial<PriceListItemDto> = {}): PriceListItemDto => ({
  brandRanges: [],
  durationMinutes: 30,
  fromBani: 15_000,
  jobTypeId: 'diagnosis',
  nameEn: 'Diagnosis and fault-code read',
  nameRo: 'Diagnoză și citire coduri de eroare',
  priceId: `price-${over.jobTypeId ?? 'diagnosis'}`,
  public: true,
  toBani: 22_000,
  updatedAt: '2026-10-18T09:00:00.000Z',
  ...over,
});

// Service Auto Militari's list as the seed holds it.
const SEEDED: PriceListItemDto[] = [
  item(),
  item({
    durationMinutes: 60,
    fromBani: 25_000,
    jobTypeId: 'oil',
    nameEn: 'Oil and filter service',
    nameRo: 'Schimb de ulei și filtre',
    toBani: 40_000,
  }),
  item({
    brandRanges: [
      { brandId: 'bmw', fromBani: 110_000, name: 'BMW', toBani: 170_000 },
    ],
    durationMinutes: 120,
    fromBani: 89_000,
    jobTypeId: 'brakes',
    nameEn: 'Front brake pads and discs',
    nameRo: 'Plăcuțe și discuri de frână față',
    toBani: 140_000,
  }),
  item({
    durationMinutes: 480,
    fromBani: 420_000,
    jobTypeId: 'chain',
    nameEn: 'Timing chain kit',
    nameRo: 'Kit lanț de distribuție',
    toBani: 680_000,
  }),
  item({
    durationMinutes: 45,
    fromBani: 28_000,
    jobTypeId: 'ac',
    nameEn: 'Air-con regas',
    nameRo: 'Încărcare freon climă',
    toBani: 36_000,
  }),
  item({
    durationMinutes: 90,
    fromBani: 35_000,
    jobTypeId: 'suspension',
    nameEn: 'Suspension check and alignment',
    nameRo: 'Verificare suspensie și geometrie',
    public: false,
    reason: 'no_top_price',
    toBani: undefined,
  }),
];

const LABOUR = { fromBani: 18_000, toBani: 24_000 };

const me = {
  garageAccess: [{ garageId: GARAGE, role: 'owner' }],
  garageId: GARAGE,
} as unknown as MeDto;

let events: Subject<LiveMessage>;
let resync: Subject<void>;
let read: jest.Mock;
let open: jest.Mock;
let setRange: jest.Mock;

async function render(
  answer: () => Promise<PriceListDto> = async () => ({
    items: SEEDED,
    labour: LABOUR,
  }),
  language: 'ro' | 'en' = 'ro',
  session: MeDto = me,
) {
  events = new Subject();
  resync = new Subject();
  read = jest.fn(answer);
  open = jest.fn(async () => 'saved');
  setRange = jest.fn(async () => ({}));
  TestBed.configureTestingModule({
    providers: [
      {
        provide: GaragesService,
        useValue: {
          priceListControllerRead: read,
          priceListControllerSetRange: setRange,
        },
      },
      { provide: Session, useValue: { shown: signal(session) } },
      { provide: Overlays, useValue: { open } },
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
  await TestBed.inject(I18n).enter('garage');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(PricesView);
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

const text = (element: Element | null) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const rows = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLElement>('[data-row]'),
];
const cell = (row: HTMLElement, name: string) =>
  text(row.querySelector(`[data-${name}]`));
const brandLines = (row: HTMLElement) =>
  [...row.querySelectorAll('[data-brand]')].map(text);
const message = (kind: string, id: string): LiveMessage => ({
  at: '2026-10-18T09:00:00.000Z',
  id,
  kind,
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => TestBed.resetTestingModule());

// @traces 172-FR-001 172-FR-002
// @traces 172-FR-003 172-FR-005
// @traces 172-FR-006 172-FR-010
describe('Prețuri: every job with its state', () => {
  it("reads the session garage's list once and shows its title and one list item per job, in the read's order", async () => {
    const { element, settle } = await render();
    await settle();

    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith({ garageId: GARAGE });
    expect(text(element.querySelector('h2'))).toBe('Lista de prețuri');
    const shown = rows(element);
    expect(shown.map((row) => row.tagName)).toEqual(Array(6).fill('LI'));
    expect(shown.map((row) => cell(row, 'name'))).toEqual(
      SEEDED.map((row) => row.nameRo),
    );
  });

  it('shows each job its duration, its state with a lamp and its range, the hidden one amber with its reason and a starting price', async () => {
    const { element, settle } = await render();
    await settle();

    const shown = rows(element);
    expect(shown.map((row) => cell(row, 'duration'))).toEqual([
      '30 min',
      '1 h',
      '2 h',
      '1 zi',
      '45 min',
      '1 h 30',
    ]);
    expect(shown.map((row) => cell(row, 'state'))).toEqual([
      ...Array(5).fill('pe profil'),
      'ascuns · fără preț maxim',
    ]);
    expect(shown.map((row) => row.dataset['public'])).toEqual([
      ...Array(5).fill('true'),
      'false',
    ]);
    expect(cell(shown[0], 'price')).toBe('150–220 lei');
    expect(cell(shown[5], 'price')).toBe('de la 350 lei');
    const lamp = shown[5].querySelector('[data-lamp]');
    expect(lamp).not.toBeNull();
    expect(lamp?.getAttribute('aria-hidden')).toBe('true');
  });

  it('speaks English in English', async () => {
    const { element, settle } = await render(undefined, 'en');
    await settle();

    const shown = rows(element);
    expect(text(element.querySelector('h2'))).toBe('Price list');
    expect(cell(shown[0], 'name')).toBe('Diagnosis and fault-code read');
    expect(cell(shown[0], 'state')).toBe('on the profile');
    expect(cell(shown[3], 'duration')).toBe('1 day');
    expect(cell(shown[5], 'state')).toBe('hidden · no top price set');
    expect(cell(shown[5], 'price')).toBe('from 350 lei');
    expect(text(element.querySelector('[data-labour]'))).toBe(
      'Labour: 180–240 lei / hour. The low end is the small, easy car; the high end is the big or awkward one.',
    );
  });

  it('names each reason in both languages, every hidden row amber', async () => {
    const reasons = [
      ['rejected', 'respins', 'rejected'],
      [
        'awaiting_approval',
        'ascuns · așteaptă aprobarea',
        'hidden · awaiting approval',
      ],
      [
        'not_authorised',
        'ascuns · nu e în autorizația RAR',
        'hidden · not in your RAR authorisation',
      ],
      ['hidden_by_garage', 'ascuns de tine', 'hidden by you'],
      ['no_top_price', 'ascuns · fără preț maxim', 'hidden · no top price set'],
    ] as const;
    const answer = async () => ({
      items: reasons.map(([reason]) =>
        item({ jobTypeId: reason, public: false, reason }),
      ),
    });
    const romanian = await render(answer);
    await romanian.settle();
    expect(rows(romanian.element).map((row) => cell(row, 'state'))).toEqual(
      reasons.map(([, ro]) => ro),
    );
    expect(rows(romanian.element).map((row) => row.dataset['public'])).toEqual(
      Array(5).fill('false'),
    );
    TestBed.resetTestingModule();

    const english = await render(answer, 'en');
    await english.settle();
    expect(rows(english.element).map((row) => cell(row, 'state'))).toEqual(
      reasons.map(([, , en]) => en),
    );
  });

  it('rounds a price in bani to whole lei', async () => {
    const { element, settle } = await render(async () => ({
      items: [item({ fromBani: 15_049, toBani: 22_051 })],
    }));
    await settle();

    expect(cell(rows(element)[0], 'price')).toBe('150–221 lei');
  });

  it('gives the hourly labour range under the list, and nothing when the read has none', async () => {
    const withLabour = await render();
    await withLabour.settle();
    expect(text(withLabour.element.querySelector('[data-labour]'))).toBe(
      'Manoperă: 180–240 lei / oră. Minimul e mașina mică și simplă, maximul e cea mare sau dificilă.',
    );
    TestBed.resetTestingModule();

    const without = await render(async () => ({ items: SEEDED }));
    await without.settle();
    expect(without.element.querySelector('[data-labour]')).toBeNull();
    expect(rows(without.element)).toHaveLength(6);
  });

  it('has one button, the editing switch, and no row action while editing is off', async () => {
    const { element, settle } = await render();
    await settle();

    expect([...element.querySelectorAll('button, a')].map(text)).toEqual([
      'Modifică prețurile',
    ]);
  });
});

// @traces 172-FR-002 172-FR-003
describe('Prețuri: a row the read gives oddly', () => {
  it('reads a hidden job with no or an unknown reason as hidden, a stray reason on a public one as on the profile, and no range as the missing mark', async () => {
    const { element, settle } = await render(
      async () => ({
        items: [
          item({ jobTypeId: 'a', public: false, reason: undefined }),
          item({
            jobTypeId: 'b',
            public: false,
            reason: 'frozen' as unknown as 'rejected',
          }),
          item({ jobTypeId: 'c', reason: 'rejected' }),
          item({
            durationMinutes: undefined,
            fromBani: undefined,
            jobTypeId: 'd',
            nameEn: '   ',
            nameRo: '<img src=x> Lucrare ț',
            toBani: undefined,
          }),
        ],
      }),
      'en',
    );
    await settle();

    const shown = rows(element);
    expect(shown.map((row) => cell(row, 'state'))).toEqual([
      'hidden',
      'hidden',
      'on the profile',
      'on the profile',
    ]);
    expect(shown.map((row) => row.dataset['public'])).toEqual([
      'false',
      'false',
      'true',
      'true',
    ]);
    expect(cell(shown[3], 'price')).toBe('—');
    expect(cell(shown[3], 'name')).toBe('<img src=x> Lucrare ț');
    expect(element.querySelector('img')).toBeNull();
    expect(shown[3].querySelector('[data-duration]')).toBeNull();
  });
});

// @traces 172-FR-004
describe('Prețuri: brand ranges under their job', () => {
  it('lists a job’s brand ranges under its row, in the read’s order, and none under a job without', async () => {
    const { element, settle } = await render(async () => ({
      items: [
        item({
          brandRanges: [
            { brandId: 'bmw', fromBani: 110_000, name: 'BMW', toBani: 170_000 },
            { brandId: 'audi', fromBani: 120_000, name: 'Audi' },
          ],
        }),
        item({ jobTypeId: 'oil' }),
      ],
    }));
    await settle();

    const [brakes, oil] = rows(element);
    expect(brandLines(brakes)).toEqual([
      'BMW · 1.100–1.700 lei',
      'Audi · de la 1.200 lei',
    ]);
    expect(brandLines(oil)).toEqual([]);
  });

  it('keeps the brand’s catalogue name in English', async () => {
    const { element, settle } = await render(undefined, 'en');
    await settle();

    expect(brandLines(rows(element)[2])).toEqual(['BMW · 1,100–1,700 lei']);
  });
});

// @traces 1357-FR-002
// @traces 1357-FR-004
describe('Prețuri: a job outside the RAR authorisation', () => {
  const regas = (shown: boolean) =>
    item({
      jobTypeId: 'ac-regas',
      nameEn: 'Air-con regas',
      nameRo: 'Încărcare freon climă',
      public: shown,
      ...(shown ? {} : { reason: 'not_authorised' as const }),
    });

  it('reads the row as hidden by the RAR authorisation with an amber lamp, in both languages', async () => {
    const answer = async () => ({ items: [regas(false)] });
    const romanian = await render(answer);
    await romanian.settle();
    const [row] = rows(romanian.element);
    expect(cell(row, 'state')).toBe('ascuns · nu e în autorizația RAR');
    expect(row.dataset['public']).toBe('false');
    expect(row.querySelector('[data-lamp]')).not.toBeNull();
    TestBed.resetTestingModule();

    const english = await render(answer, 'en');
    await english.settle();
    expect(cell(rows(english.element)[0], 'state')).toBe(
      'hidden · not in your RAR authorisation',
    );
  });

  it('turns the row to on the profile when a price list change re-reads it covered', async () => {
    let covered = false;
    const { element, settle } = await render(async () => ({
      items: [regas(covered)],
    }));
    await settle();
    expect(rows(element)[0].dataset['public']).toBe('false');

    covered = true;
    events.next(message('price_list.updated', GARAGE));
    await wait(350);
    await settle();

    const [row] = rows(element);
    expect(cell(row, 'state')).toBe('pe profil');
    expect(row.dataset['public']).toBe('true');
  });
});

// @traces 172-FR-007 172-FR-008
// @traces 1352-FR-001
describe('Prețuri: live, loading, failure and an empty list', () => {
  it('shows busy skeleton rows with no text while the first read runs', async () => {
    let finish: (() => void) | undefined;
    const { element, settle } = await render(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ items: SEEDED });
        }),
    );
    await settle();

    const panel = element.querySelector('section.panel');
    expect(text(panel?.querySelector('h2') ?? null)).toBe('Lista de prețuri');
    expect(panel?.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(panel?.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(
      0,
    );
    expect(text(panel?.querySelector('[aria-busy="true"]') ?? null)).toBe('');
    expect(text(element)).toBe('Lista de prețuri');
    expect(rows(element)).toHaveLength(0);
    finish?.();
    await settle();
    expect(rows(element)).toHaveLength(6);
    expect(element.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('says the read failed and reads again on Încearcă din nou', async () => {
    let fail = true;
    const { element, settle } = await render(async () => {
      if (fail) throw new HttpErrorResponse({ status: 500 });
      return { items: SEEDED };
    });
    await settle();

    const panel = element.querySelector('section.panel');
    expect(text(panel?.querySelector('h2') ?? null)).toBe('Lista de prețuri');
    expect(panel?.querySelector('[role="alert"]')).not.toBeNull();
    const retry = panel?.querySelector('button') as HTMLButtonElement;
    expect(text(retry)).toBe('Încearcă din nou');
    fail = false;
    retry.click();
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
    expect(rows(element)).toHaveLength(6);
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });

  it('says the list is empty, with no row or note, and offers only the switch and the add', async () => {
    const { element, settle } = await render(async () => ({
      items: [],
      labour: LABOUR,
    }));
    await settle();

    const panel = element.querySelector('section.panel');
    expect(text(panel?.querySelector('h2') ?? null)).toBe('Lista de prețuri');
    expect(text(panel?.querySelector('p') ?? null)).toBe(
      'Nu ai încă lucrări în listă.',
    );
    expect(panel?.children).toHaveLength(3);
    expect(rows(element)).toHaveLength(0);
    expect(element.querySelector('[data-labour]')).toBeNull();
    expect([...element.querySelectorAll('button')].map(text)).toEqual([
      'Modifică prețurile',
      'Adaugă o lucrare',
    ]);
  });

  it('never says the list is empty when the garage is gone', async () => {
    const { element, settle } = await render(async () => {
      throw new HttpErrorResponse({ status: 404 });
    });
    await settle();

    expect(text(element)).not.toContain('Nu ai încă lucrări în listă.');
    expect(rows(element)).toHaveLength(0);
  });

  it("reads again on its garage's price list change and a catalogue decision, a burst as one read, and not on another garage's change", async () => {
    const { element, settle } = await render();
    await settle();
    expect(read).toHaveBeenCalledTimes(1);

    events.next(message('price_list.updated', 'another-garage'));
    await wait(350);
    await settle();
    expect(read).toHaveBeenCalledTimes(1);

    events.next(message('price_list.updated', GARAGE));
    events.next(message('price_list.updated', GARAGE));
    await wait(350);
    await settle();
    expect(read).toHaveBeenCalledTimes(2);

    events.next(message('catalogue_job.decided', 'job-type-1'));
    await wait(350);
    await settle();
    expect(read).toHaveBeenCalledTimes(3);
    expect(rows(element)).toHaveLength(6);
  });

  it('reads again on a resync', async () => {
    const { settle } = await render();
    await settle();

    resync.next();
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
  });

  it('keeps the rows shown when a re-read fails', async () => {
    let fail = false;
    const { element, settle } = await render(async () => {
      if (fail) throw new HttpErrorResponse({ status: 500 });
      return { items: SEEDED };
    });
    await settle();
    fail = true;

    resync.next();
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
    expect(rows(element)).toHaveLength(6);
  });
});

const buttons = (root: Element) => [...root.querySelectorAll('button')];
const named = (root: Element, name: string) =>
  buttons(root).find((b) => text(b) === name) as HTMLButtonElement;
const editButtons = (root: Element) =>
  buttons(root).filter((b) => text(b) === 'Modifică');

// @traces 173-FR-001
// @traces 173-FR-011
describe('Prețuri: the editing switch', () => {
  it('turns every row, brand line and the labour note editable, and back', async () => {
    const { element, settle } = await render();
    await settle();
    const toggle = named(element, 'Modifică prețurile');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    // The board's amber button: the kit's primary variant.
    expect(toggle.classList).toContain('spartan-button-variant-default');

    toggle.click();
    await settle();

    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(text(toggle)).toBe('Gata');
    // Six rows, one brand line, the labour note.
    expect(editButtons(element)).toHaveLength(8);
    for (const row of rows(element))
      expect(
        [...row.querySelectorAll(':scope > .line button, :scope > button')]
          .length,
      ).toBe(1);

    toggle.click();
    await settle();

    expect(text(toggle)).toBe('Modifică prețurile');
    expect(editButtons(element)).toHaveLength(0);
  });

  it("names each row's action after its job", async () => {
    const { element, settle } = await render();
    await settle();
    named(element, 'Modifică prețurile').click();
    await settle();

    const [first] = editButtons(element);
    expect(first.getAttribute('aria-label')).toBe(
      'Modifică Diagnoză și citire coduri de eroare',
    );
  });

  it('speaks English in English', async () => {
    const { element, settle } = await render(undefined, 'en');
    await settle();
    const toggle = named(element, 'Edit prices');

    toggle.click();
    await settle();

    expect(text(toggle)).toBe('Done');
    expect(buttons(element).filter((b) => text(b) === 'Edit')).toHaveLength(8);
  });

  it('offers an unset labour range only while editing', async () => {
    const { element, settle } = await render(async () => ({
      items: SEEDED,
    }));
    await settle();
    expect(element.querySelector('[data-labour]')).toBeNull();

    named(element, 'Modifică prețurile').click();
    await settle();

    expect(text(element.querySelector('[data-labour]'))).toBe(
      'Manoperă: nesetată Modifică',
    );
  });

  it('shows no switch and no action to anyone but the owner', async () => {
    const { element, settle } = await render(undefined, 'ro', {
      garageAccess: [{ garageId: GARAGE, role: 'receptionist' }],
      garageId: GARAGE,
    } as unknown as MeDto);
    await settle();

    expect(buttons(element)).toHaveLength(0);
  });
});

// @traces 173-FR-002
// @traces 173-FR-005
// @traces 173-FR-012
describe('Prețuri: opening an editor', () => {
  const editing = async () => {
    const view = await render();
    await view.settle();
    named(view.element, 'Modifică prețurile').click();
    await view.settle();
    return view;
  };

  it("opens a row's editor titled with its job and re-reads after a save, never patching the row", async () => {
    const { element, settle } = await editing();
    const brakes = rows(element)[2];

    (brakes.querySelector('button') as HTMLButtonElement).click();
    await settle();

    expect(open).toHaveBeenCalledWith(PriceRangeEditor, {
      data: { garageId: GARAGE, item: SEEDED[2], kind: 'row' },
      shape: 'dialog',
      title: 'Plăcuțe și discuri de frână față',
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(cell(rows(element)[2], 'price')).toBe(cell(brakes, 'price'));
  });

  it('reads nothing again when the editor is cancelled', async () => {
    const { element, settle } = await editing();
    open.mockResolvedValueOnce('cancelled');

    (rows(element)[0].querySelector('button') as HTMLButtonElement).click();
    await settle();

    expect(read).toHaveBeenCalledTimes(1);
  });

  it("opens a brand line's editor on its brand", async () => {
    const { element, settle } = await editing();

    (element.querySelector('[data-brand] button') as HTMLButtonElement).click();
    await settle();

    expect(open).toHaveBeenCalledWith(PriceRangeEditor, {
      data: {
        brand: SEEDED[2].brandRanges[0],
        garageId: GARAGE,
        jobTypeId: 'brakes',
        kind: 'brand',
      },
      shape: 'dialog',
      title: 'Plăcuțe și discuri de frână față · BMW',
    });
  });

  it("opens the labour editor on the garage's labour range", async () => {
    const { element, settle } = await editing();
    const action = element.querySelector(
      '[data-labour] button',
    ) as HTMLButtonElement;

    // Named from the garage texts the view loads, not the public listing's.
    expect(action.getAttribute('aria-label')).toBe('Modifică Manoperă, pe oră');
    action.click();
    await settle();

    expect(open).toHaveBeenCalledWith(PriceRangeEditor, {
      data: { garageId: GARAGE, kind: 'labour', labour: LABOUR },
      shape: 'dialog',
      title: 'garage.prices.labourTitle',
    });
  });
});

const AC_JOB = {
  id: 'ac-new',
  key: 'ac-regas',
  nameEn: 'Air-con regas',
  nameRo: 'Încărcare freon climă',
};

const editingOn = async (
  answer?: () => Promise<PriceListDto>,
  language: 'ro' | 'en' = 'ro',
) => {
  const view = await render(answer, language);
  await view.settle();
  named(
    view.element,
    language === 'en' ? 'Edit prices' : 'Modifică prețurile',
  ).click();
  await view.settle();
  return view;
};

// @traces 1352-FR-001
describe('Prețuri: adding a job', () => {
  it('offers "Adaugă o lucrare" under the list while editing, and not before', async () => {
    const { element, settle } = await render();
    await settle();
    expect(named(element, 'Adaugă o lucrare')).toBeUndefined();

    named(element, 'Modifică prețurile').click();
    await settle();

    const add = named(element, 'Adaugă o lucrare');
    expect(add.disabled).toBe(false);
    expect(add.classList).toContain('spartan-button-variant-secondary');
    // Under the list, not inside a row.
    expect(add.closest('[data-row]')).toBeNull();
    const list = element.querySelector('ul.rows') as HTMLElement;
    expect(
      list.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('offers it to no one but the owner, an empty list included', async () => {
    const { element, settle } = await render(
      async () => ({ items: [] }),
      'ro',
      {
        garageAccess: [{ garageId: GARAGE, role: 'mechanic' }],
        garageId: GARAGE,
      } as unknown as MeDto,
    );
    await settle();

    expect(buttons(element)).toHaveLength(0);
  });

  it('is disabled at 50 jobs, saying so', async () => {
    const fifty = Array.from({ length: 50 }, (_, n) =>
      item({ jobTypeId: `job-${n}`, nameRo: `Lucrarea ${n}` }),
    );
    const { element } = await editingOn(async () => ({ items: fifty }));

    const add = named(element, 'Adaugă o lucrare');
    expect(add.disabled).toBe(true);
    const hint = document.getElementById(
      add.getAttribute('aria-describedby') ?? '',
    );
    expect(text(hint)).toBe('Cel mult 50 de lucrări');
  });

  it('opens the picker without the listed jobs, then the editor for the picked job, and re-reads after the save', async () => {
    const { element, settle } = await editingOn();
    open.mockResolvedValueOnce({ job: AC_JOB }).mockResolvedValueOnce('saved');

    named(element, 'Adaugă o lucrare').click();
    await settle();

    expect(open).toHaveBeenNthCalledWith(1, JobPicker, {
      data: { listed: SEEDED.map((row) => row.jobTypeId) },
      shape: 'dialog',
      title: 'garage.prices.picker.title',
    });
    expect(open).toHaveBeenNthCalledWith(2, PriceRangeEditor, {
      data: {
        garageId: GARAGE,
        job: AC_JOB,
        kind: 'new',
        listed: expect.any(Function),
      },
      shape: 'dialog',
      title: 'Încărcare freon climă',
    });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('re-reads the list while the editor is still open when it answers duplicate', async () => {
    const { element, settle } = await editingOn();
    let close: (result: string) => void = () => undefined;
    open
      .mockResolvedValueOnce({ job: AC_JOB })
      .mockImplementationOnce(
        () => new Promise((resolve) => (close = resolve)),
      );

    named(element, 'Adaugă o lucrare').click();
    await settle();
    open.mock.calls[1][1].data.listed();
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
    close('cancelled');
    await settle();
  });

  it('titles the editor with the English name in English', async () => {
    const { element, settle } = await editingOn(undefined, 'en');
    open.mockResolvedValueOnce({ job: AC_JOB }).mockResolvedValueOnce('saved');

    named(element, 'Add a job').click();
    await settle();

    expect(open.mock.calls[1][1].title).toBe('Air-con regas');
  });

  it('opens no editor when the picker is closed', async () => {
    const { element, settle } = await editingOn();
    open.mockResolvedValueOnce('cancelled');

    named(element, 'Adaugă o lucrare').click();
    await settle();

    expect(open).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('offers it on an empty list without editing, and opens the picker from there', async () => {
    const { element, settle } = await render(async () => ({ items: [] }));
    await settle();
    open.mockResolvedValueOnce('cancelled');

    named(element, 'Adaugă o lucrare').click();
    await settle();

    expect(open).toHaveBeenCalledWith(JobPicker, {
      data: { listed: [] },
      shape: 'dialog',
      title: 'garage.prices.picker.title',
    });
  });
});

const action = (row: HTMLElement, name: string) =>
  [...row.querySelectorAll('button')].find(
    (b) => text(b) === name,
  ) as HTMLButtonElement;

// @traces 1352-FR-004
describe('Prețuri: hiding and showing a job', () => {
  const hiddenByOwner = async () =>
    editingOn(async () => ({
      items: [
        ...SEEDED.slice(0, 3),
        item({
          ...SEEDED[3],
          public: false,
          reason: 'hidden_by_garage',
          visible: false,
        }),
        ...SEEDED.slice(4),
      ],
    }));

  it('offers Ascunde on a job the owner did not hide and Arată on one they did, named after the job, only while editing', async () => {
    const { element } = await hiddenByOwner();
    const [diagnosis, , , chain, , suspension] = rows(element);

    expect(action(diagnosis, 'Ascunde').getAttribute('aria-label')).toBe(
      'Ascunde Diagnoză și citire coduri de eroare',
    );
    expect(action(diagnosis, 'Ascunde').classList).toContain(
      'spartan-button-variant-ghost',
    );
    expect(action(chain, 'Arată').getAttribute('aria-label')).toBe(
      'Arată Kit lanț de distribuție',
    );
    expect(cell(chain, 'state')).toBe('ascuns de tine');
    // Hidden for a missing top price, not by the owner.
    expect(action(suspension, 'Ascunde')).toBeDefined();
  });

  it('offers Arată on a job the owner hid whose first reason is another', async () => {
    const { element } = await editingOn(async () => ({
      items: [
        item({ public: false, reason: 'awaiting_approval', visible: false }),
      ],
    }));
    const [row] = rows(element);

    expect(cell(row, 'state')).toBe('ascuns · așteaptă aprobarea');
    expect(action(row, 'Arată')).toBeDefined();
    expect(action(row, 'Ascunde')).toBeUndefined();
  });

  it('offers no action on a job priced by brand alone', async () => {
    const { element } = await editingOn(async () => ({
      items: [
        item({
          brandRanges: [
            { brandId: 'bmw', fromBani: 1000, name: 'BMW', toBani: 2000 },
          ],
          priceId: undefined,
          updatedAt: undefined,
        }),
      ],
    }));
    const [row] = rows(element);

    expect(action(row, 'Ascunde')).toBeUndefined();
    expect(action(row, 'Șterge')).toBeUndefined();
  });

  it('hides the job on Ascunde, the row busy and its buttons locked while it saves, then re-reads', async () => {
    let answer: (value: unknown) => void = () => undefined;
    const { element, settle } = await editingOn();
    setRange.mockImplementationOnce(
      () => new Promise((resolve) => (answer = resolve)),
    );
    const row = rows(element)[0];

    action(row, 'Ascunde').click();
    await settle();

    expect(setRange).toHaveBeenCalledWith({
      body: { visible: false },
      garageId: GARAGE,
      priceId: 'price-diagnosis',
    });
    expect(row.getAttribute('aria-busy')).toBe('true');
    for (const b of row.querySelectorAll('button'))
      expect(b.disabled).toBe(true);
    expect(rows(element)[1].getAttribute('aria-busy')).toBeNull();

    answer({});
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
    expect(rows(element)[0].getAttribute('aria-busy')).toBeNull();
    expect(action(rows(element)[0], 'Ascunde').disabled).toBe(false);
  });

  it('shows the job on Arată', async () => {
    const { element, settle } = await hiddenByOwner();

    action(rows(element)[3], 'Arată').click();
    await settle();

    expect(setRange).toHaveBeenCalledWith({
      body: { visible: true },
      garageId: GARAGE,
      priceId: 'price-chain',
    });
  });

  it('says on the row that it was not saved when the save fails, unlocked and as it was', async () => {
    const { element, settle } = await editingOn();
    setRange.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
    const row = rows(element)[0];

    action(row, 'Ascunde').click();
    await settle();

    const failed = rows(element)[0];
    expect(text(failed.querySelector('[role="alert"]'))).toBe(
      'Nu s‑a salvat. Încearcă din nou.',
    );
    expect(failed.getAttribute('aria-busy')).toBeNull();
    expect(action(failed, 'Ascunde').disabled).toBe(false);
    expect(cell(failed, 'state')).toBe('pe profil');
    expect(read).toHaveBeenCalledTimes(1);
    expect(rows(element)[1].querySelector('[role="alert"]')).toBeNull();
  });

  it('speaks English in English', async () => {
    const { element } = await editingOn(undefined, 'en');
    const [row] = rows(element);

    expect(action(row, 'Hide').getAttribute('aria-label')).toBe(
      'Hide Diagnosis and fault-code read',
    );
    expect(action(row, 'Remove').getAttribute('aria-label')).toBe(
      'Remove Diagnosis and fault-code read',
    );
  });
});

// @traces 1352-FR-006
describe('Prețuri: removing a job', () => {
  it('offers Șterge on each job with its own row, named after the job, only while editing', async () => {
    const { element, settle } = await render();
    await settle();
    expect(action(rows(element)[0], 'Șterge')).toBeUndefined();

    named(element, 'Modifică prețurile').click();
    await settle();

    expect(
      rows(element).map((row) =>
        action(row, 'Șterge')?.getAttribute('aria-label'),
      ),
    ).toEqual(SEEDED.map((row) => `Șterge ${row.nameRo}`));
  });

  it('asks first, then re-reads once the job is removed', async () => {
    const { element, settle } = await editingOn();
    open.mockResolvedValueOnce('removed');

    action(rows(element)[2], 'Șterge').click();
    await settle();

    expect(open).toHaveBeenCalledWith(RemoveJob, {
      data: { garageId: GARAGE, priceId: 'price-brakes' },
      shape: 'dialog',
      title: 'garage.prices.removeDialog.title',
    });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('reads nothing again when the question is cancelled', async () => {
    const { element, settle } = await editingOn();
    open.mockResolvedValueOnce('cancelled');

    action(rows(element)[2], 'Șterge').click();
    await settle();

    expect(read).toHaveBeenCalledTimes(1);
  });
});

// @traces 1352-FR-009
describe('Prețuri: proposing a job the catalogue lacks', () => {
  it('opens the propose form from the picker and re-reads after it is sent', async () => {
    const { element, settle } = await editingOn();
    open.mockResolvedValueOnce('propose').mockResolvedValueOnce('saved');

    named(element, 'Adaugă o lucrare').click();
    await settle();

    expect(open).toHaveBeenNthCalledWith(2, PriceRangeEditor, {
      data: { garageId: GARAGE, kind: 'propose' },
      shape: 'dialog',
      title: 'garage.prices.propose.title',
    });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('does not re-read when the propose form is closed unsent', async () => {
    const { element, settle } = await editingOn();
    open.mockResolvedValueOnce('propose').mockResolvedValueOnce('cancelled');

    named(element, 'Adaugă o lucrare').click();
    await settle();

    expect(open).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('notes under a job waiting for approval that it is being checked', async () => {
    const waiting = item({
      jobTypeId: 'injectors',
      nameRo: 'Recondiționare injectoare',
      public: false,
      reason: 'awaiting_approval',
      visible: true,
    });
    const { element, settle } = await render(async () => ({
      items: [SEEDED[0], waiting],
    }));
    await settle();

    const [listed, proposed] = rows(element);
    expect(cell(proposed, 'state')).toBe('ascuns · așteaptă aprobarea');
    expect(cell(proposed, 'note')).toBe(
      'O verificăm și îți spunem când e pe profil.',
    );
    expect(listed.querySelector('[data-note]')).toBeNull();
  });
});
