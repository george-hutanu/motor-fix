// @traces 1405-FR-001 1405-FR-002 1405-FR-003 1405-FR-004 1405-FR-006 1405-FR-008
import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  type AdminRepairDto,
  type AdminRepairListItemDto,
  AdminService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { type OverlayOptions, Overlays } from '@motor-fix/overlays';

import { AdminAccountRepairs } from './admin-account-repairs';
import type { AdminRepairData } from '../../admin-repair-dialog/admin-repair-dialog';

@Component({
  imports: [AdminAccountRepairs],
  template: '<mf-admin-account-repairs [accountId]="id()" />',
})
class Host {
  readonly id = signal('acc-1');
}

const row = (
  id: string,
  doneOn: string,
  car = { brandName: 'Dacia', model: 'Logan', year: 2018 },
): AdminRepairListItemDto => ({ car, doneOn, id });

const repair = (extra: Partial<AdminRepairDto> = {}): AdminRepairDto => ({
  car: { brandName: 'Dacia', model: 'Logan', year: 2018 },
  correctedBy: null,
  costBani: 45000,
  doneOn: '2025-03-12',
  garageName: 'Garaj Nordic',
  id: 'r-1',
  odometerKm: 91300,
  version: '2026-10-30T10:00:00.000Z',
  what: 'Schimb ulei și filtre',
  ...extra,
});

let list: jest.Mock;
let openRead: jest.Mock;
let overlayOpen: jest.Mock;
let element: HTMLElement;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function mount(
  answer:
    | { items: AdminRepairListItemDto[]; truncated: boolean }
    | HttpErrorResponse = {
    items: [row('r-1', '2025-03-12'), row('r-2', '2024-11-02')],
    truncated: false,
  },
  language: 'ro' | 'en' = 'ro',
) {
  list = jest.fn(async () => {
    if (answer instanceof HttpErrorResponse) throw answer;
    return answer;
  });
  openRead ??= jest.fn(async ({ id }: { id: string }) => repair({ id }));
  overlayOpen ??= jest.fn(async () => 'cancelled');
  TestBed.configureTestingModule({
    providers: [
      {
        provide: AdminService,
        useValue: {
          adminRepairsControllerList: list,
          adminRepairsControllerOpen: openRead,
        },
      },
      { provide: Overlays, useValue: { open: overlayOpen } },
    ],
  });
  const i18n = TestBed.inject(I18n);
  if (language === 'en') await i18n.use('en');
  await i18n.enter('admin');
  const host = TestBed.createComponent(Host);
  element = host.nativeElement;
  document.body.append(element);
  await settle();
}

const text = (el: Element | null = element) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const rows = () => [...element.querySelectorAll('li')].map((li) => text(li));
const button = (name: string) =>
  [...element.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => text(b) === name,
  ) as HTMLButtonElement;
const openButtons = () => [
  ...element.querySelectorAll<HTMLButtonElement>('li button'),
];

beforeEach(() => {
  openRead = undefined as unknown as jest.Mock;
  overlayOpen = undefined as unknown as jest.Mock;
});

afterEach(() => {
  TestBed.resetTestingModule();
  document.body.innerHTML = '';
});

describe("the account's added repairs", () => {
  it("reads the account's logged repairs under their heading", async () => {
    await mount();

    expect(list).toHaveBeenCalledWith({ id: 'acc-1' });
    expect(text(element.querySelector('h3'))).toBe('Reparații adăugate');
  });

  it('shows each row as its date and car with Deschide, in the order answered', async () => {
    await mount();

    expect(rows()).toEqual([
      '12 mart. 2025 · Dacia Logan 2018 Deschide',
      '2 nov. 2024 · Dacia Logan 2018 Deschide',
    ]);
  });

  it('shows nothing of the repair but its date and car', async () => {
    await mount();

    expect(text()).not.toContain('Schimb ulei');
    expect(text()).not.toContain('Garaj Nordic');
    expect(text()).not.toContain('lei');
    expect(text()).not.toContain('km');
  });

  it('names each open button after its row for a screen reader', async () => {
    await mount();

    expect(openButtons()[0].getAttribute('aria-label')).toBe(
      'Deschide reparația din 12 mart. 2025, Dacia Logan 2018',
    );
  });

  it('says when the account has added no repair', async () => {
    await mount({ items: [], truncated: false });

    expect(text()).toContain('Nicio reparație adăugată de acest cont');
    expect(element.querySelectorAll('li')).toHaveLength(0);
  });

  it('says there are more when the list was cut', async () => {
    await mount({ items: [row('r-1', '2025-03-12')], truncated: true });

    expect(text()).toContain('și altele');
  });

  it('does not say there are more when the list is whole', async () => {
    await mount();

    expect(text()).not.toContain('și altele');
  });

  it('shows a skeleton while the list is read', async () => {
    let answer: (value: unknown) => void = () => undefined;
    list = jest.fn(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AdminService,
          useValue: { adminRepairsControllerList: list },
        },
        { provide: Overlays, useValue: { open: jest.fn() } },
      ],
    });
    await TestBed.inject(I18n).enter('admin');
    const host = TestBed.createComponent(Host);
    element = host.nativeElement;
    await settle();

    expect(
      element.querySelector('[aria-busy="true"] .skeleton'),
    ).not.toBeNull();
    answer({ items: [], truncated: false });
    await settle();
    expect(element.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('says the list failed and reads it again on Reîncearcă', async () => {
    await mount(new HttpErrorResponse({ status: 500 }));

    expect(text(element.querySelector('[role="alert"]'))).toContain(
      'Reparațiile nu s‑au încărcat.',
    );
    list.mockResolvedValue({
      items: [row('r-1', '2025-03-12')],
      truncated: false,
    });
    button('Reîncearcă').click();
    await settle();

    expect(list).toHaveBeenCalledTimes(2);
    expect(rows()).toEqual(['12 mart. 2025 · Dacia Logan 2018 Deschide']);
  });

  it('reads the repair, then opens the dialog with it, loaded on demand', async () => {
    await mount();

    openButtons()[0].click();
    await settle();

    expect(openRead).toHaveBeenCalledWith({ id: 'r-1' });
    expect(overlayOpen).toHaveBeenCalledTimes(1);
    const [source, options] = overlayOpen.mock.calls[0] as [
      unknown,
      OverlayOptions<AdminRepairData>,
    ];
    expect(typeof source).toBe('function');
    expect((source as { prototype?: unknown }).prototype).toBeUndefined();
    expect(options.shape).toBe('dialog');
    expect(options.title).toBe('admin.users.dialogs.repair.title');
    expect(options.data?.repair).toEqual(repair({ id: 'r-1' }));
  });

  it('opens one repair at a time', async () => {
    await mount();

    openButtons()[0].click();
    openButtons()[1].click();
    await settle();

    expect(openRead).toHaveBeenCalledTimes(1);
  });

  it('opens no dialog and removes the row when the repair is gone', async () => {
    openRead = jest.fn(async () => {
      throw new HttpErrorResponse({ status: 404 });
    });
    await mount();

    openButtons()[0].click();
    await settle();

    expect(overlayOpen).not.toHaveBeenCalled();
    expect(rows()).toEqual(['2 nov. 2024 · Dacia Logan 2018 Deschide']);
    expect(text(element.querySelector('[aria-live="polite"]'))).toBe(
      'Reparația nu mai există',
    );
  });

  it('opens no dialog and keeps the row when the read fails otherwise', async () => {
    openRead = jest.fn(async () => {
      throw new HttpErrorResponse({ status: 503 });
    });
    await mount();

    openButtons()[0].click();
    await settle();

    expect(overlayOpen).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(2);
    expect(text(element.querySelector('[role="alert"]'))).toContain(
      'Reparația nu s‑a deschis.',
    );
  });

  it('updates the row in place when the dialog saves a correction, without reading the list again', async () => {
    overlayOpen = jest.fn(
      async (_source: unknown, options: OverlayOptions<AdminRepairData>) => {
        options.data?.saved(repair({ doneOn: '2023-01-05', id: 'r-1' }));
        return 'cancelled';
      },
    );
    await mount();

    openButtons()[0].click();
    await settle();

    expect(list).toHaveBeenCalledTimes(1);
    expect(rows()).toEqual([
      '5 ian. 2023 · Dacia Logan 2018 Deschide',
      '2 nov. 2024 · Dacia Logan 2018 Deschide',
    ]);
  });

  it('removes the row and says so when the dialog closes on a repair that is gone', async () => {
    overlayOpen = jest.fn(async () => 'gone');
    await mount();

    openButtons()[0].click();
    await settle();

    expect(rows()).toEqual(['2 nov. 2024 · Dacia Logan 2018 Deschide']);
    expect(text(element.querySelector('[aria-live="polite"]'))).toBe(
      'Reparația nu mai există',
    );
  });

  it('offers no delete action', async () => {
    await mount();

    const names = [...element.querySelectorAll('button')].map((b) =>
      text(b).toLowerCase(),
    );
    expect(names.some((n) => n.includes('șterge'))).toBe(false);
  });

  it('speaks English', async () => {
    await mount({ items: [row('r-1', '2025-03-12')], truncated: true }, 'en');

    expect(text(element.querySelector('h3'))).toBe('Added repairs');
    expect(rows()).toEqual(['12 Mar 2025 · Dacia Logan 2018 Open']);
    expect(text()).toContain('and more');
    const names = [...element.querySelectorAll('button')].map((b) =>
      text(b).toLowerCase(),
    );
    expect(names.some((n) => n.includes('delete'))).toBe(false);
  });

  it('says in English when the account has added no repair', async () => {
    await mount({ items: [], truncated: false }, 'en');

    expect(text()).toContain('No repair added by this account');
  });
});
