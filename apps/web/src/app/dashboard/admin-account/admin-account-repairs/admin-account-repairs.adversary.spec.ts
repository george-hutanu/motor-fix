// @traces 1405-FR-001 1405-FR-002 1405-FR-004
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

const car = { brandName: 'Dacia', model: 'Logan', year: 2018 };
const row = (id: string, doneOn: string, c = car): AdminRepairListItemDto => ({
  car: c,
  doneOn,
  id,
});

const repair = (extra: Partial<AdminRepairDto> = {}): AdminRepairDto => ({
  car,
  correctedBy: null,
  costBani: 45000,
  doneOn: '2025-03-12',
  garageName: 'Garaj Nordic',
  id: 'r-1',
  odometerKm: 91300,
  version: '2026-10-30T10:00:00.000Z',
  what: 'Schimb ulei',
  ...extra,
});

let element: HTMLElement;
let host: ReturnType<typeof TestBed.createComponent<Host>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function mount(services: {
  list: jest.Mock;
  open?: jest.Mock;
  overlay?: jest.Mock;
}) {
  TestBed.configureTestingModule({
    providers: [
      {
        provide: AdminService,
        useValue: {
          adminRepairsControllerList: services.list,
          adminRepairsControllerOpen:
            services.open ?? jest.fn(async ({ id }) => repair({ id })),
        },
      },
      {
        provide: Overlays,
        useValue: {
          open: services.overlay ?? jest.fn(async () => 'cancelled'),
        },
      },
    ],
  });
  await TestBed.inject(I18n).enter('admin');
  host = TestBed.createComponent(Host);
  element = host.nativeElement;
  document.body.append(element);
  await settle();
}

const text = (el: Element | null = element) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const rows = () => [...element.querySelectorAll('li')].map((li) => text(li));
const openButtons = () => [
  ...element.querySelectorAll<HTMLButtonElement>('li button'),
];

afterEach(() => {
  TestBed.resetTestingModule();
  document.body.innerHTML = '';
});

describe('the account repairs section under hostile input', () => {
  // Five times the API's LIST_LIMIT (200): ten thousand rows timed out under load.
  it('renders a thousand rows in the order answered', async () => {
    const items = Array.from({ length: 1000 }, (_, i) =>
      row(`r-${i}`, '2025-03-12'),
    );
    await mount({ list: jest.fn(async () => ({ items, truncated: true })) });

    expect(element.querySelectorAll('li')).toHaveLength(1000);
    expect(text()).toContain('și altele');
  }, 60000);

  it('shows the empty state, not the more line, for an empty cut list', async () => {
    await mount({
      list: jest.fn(async () => ({ items: [], truncated: true })),
    });

    expect(text()).toContain('Nicio reparație adăugată de acest cont');
  });

  it('shows brand and model markup as plain text', async () => {
    await mount({
      list: jest.fn(async () => ({
        items: [
          row('r-1', '2025-03-12', {
            brandName: '<img src=x onerror=alert(1)>',
            model: 'Școală 🚗',
            year: 2018,
          }),
        ],
        truncated: false,
      })),
    });

    expect(element.querySelector('img')).toBeNull();
    expect(rows()[0]).toContain('<img src=x onerror=alert(1)> Școală 🚗 2018');
  });

  it('reads the list of the new account when the account changes', async () => {
    const list = jest.fn(async ({ id }: { id: string }) => ({
      items: [row(`${id}-r`, id === 'acc-1' ? '2025-03-12' : '2024-11-02')],
      truncated: false,
    }));
    await mount({ list });

    host.componentInstance.id.set('acc-2');
    await settle();

    expect(list).toHaveBeenLastCalledWith({ id: 'acc-2' });
    expect(rows()).toEqual(['2 nov. 2024 · Dacia Logan 2018 Deschide']);
  });

  it('shows the latest account when an earlier read answers last', async () => {
    const resolvers: Record<string, (v: unknown) => void> = {};
    const list = jest.fn(
      ({ id }: { id: string }) =>
        new Promise((resolve) => {
          resolvers[id] = resolve;
        }),
    );
    await mount({ list });
    host.componentInstance.id.set('acc-2');
    await settle();

    resolvers['acc-2']({
      items: [row('b', '2024-11-02')],
      truncated: false,
    });
    await settle();
    resolvers['acc-1']({
      items: [row('a', '2025-03-12')],
      truncated: false,
    });
    await settle();

    expect(rows()).toEqual(['2 nov. 2024 · Dacia Logan 2018 Deschide']);
  });

  it('does not add a row when the dialog saves a repair the list does not hold', async () => {
    const overlay = jest.fn(
      async (_s: unknown, options: OverlayOptions<AdminRepairData>) => {
        options.data?.saved(repair({ doneOn: '2020-01-01', id: 'stranger' }));
        return 'cancelled';
      },
    );
    await mount({
      list: jest.fn(async () => ({
        items: [row('r-1', '2025-03-12')],
        truncated: false,
      })),
      overlay,
    });

    openButtons()[0].click();
    await settle();

    expect(rows()).toEqual(['12 mart. 2025 · Dacia Logan 2018 Deschide']);
  });

  it('shows the empty state once the last row has gone', async () => {
    await mount({
      list: jest.fn(async () => ({
        items: [row('r-1', '2025-03-12')],
        truncated: false,
      })),
      overlay: jest.fn(async () => 'gone'),
    });

    openButtons()[0].click();
    await settle();

    expect(element.querySelectorAll('li')).toHaveLength(0);
    expect(text()).toContain('Nicio reparație adăugată de acest cont');
  });

  it('keeps the more line after a row is removed from a cut list', async () => {
    await mount({
      list: jest.fn(async () => ({
        items: [row('r-1', '2025-03-12'), row('r-2', '2024-11-02')],
        truncated: true,
      })),
      overlay: jest.fn(async () => 'gone'),
    });

    openButtons()[0].click();
    await settle();

    expect(rows()).toHaveLength(1);
    expect(text()).toContain('și altele');
  });

  it('opens again after a failed open read', async () => {
    const open = jest
      .fn()
      .mockRejectedValueOnce(new HttpErrorResponse({ status: 503 }))
      .mockResolvedValueOnce(repair());
    const overlay = jest.fn(async () => 'cancelled');
    await mount({
      list: jest.fn(async () => ({
        items: [row('r-1', '2025-03-12')],
        truncated: false,
      })),
      open,
      overlay,
    });

    openButtons()[0].click();
    await settle();
    openButtons()[0].click();
    await settle();

    expect(overlay).toHaveBeenCalledTimes(1);
  });

  it('clears the open error line once a later open succeeds', async () => {
    const open = jest
      .fn()
      .mockRejectedValueOnce(new HttpErrorResponse({ status: 503 }))
      .mockResolvedValueOnce(repair());
    await mount({
      list: jest.fn(async () => ({
        items: [row('r-1', '2025-03-12')],
        truncated: false,
      })),
      open,
    });

    openButtons()[0].click();
    await settle();
    openButtons()[0].click();
    await settle();

    expect(text()).not.toContain('Reparația nu s‑a deschis.');
  });

  it('keeps the rows and says the open failed on a 403', async () => {
    const overlay = jest.fn();
    await mount({
      list: jest.fn(async () => ({
        items: [row('r-1', '2025-03-12')],
        truncated: false,
      })),
      open: jest.fn(async () => {
        throw new HttpErrorResponse({ status: 403 });
      }),
      overlay,
    });

    openButtons()[0].click();
    await settle();

    expect(overlay).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(1);
    expect(text(element.querySelector('[role="alert"]'))).toContain(
      'Reparația nu s‑a deschis.',
    );
  });

  it('shows the list failure line, not the empty state, when the read fails', async () => {
    await mount({
      list: jest.fn(async () => {
        throw new HttpErrorResponse({ status: 0 });
      }),
    });

    expect(text()).not.toContain('Nicio reparație adăugată');
    expect(element.querySelectorAll('li')).toHaveLength(0);
  });

  it('keeps showing the failure when Reîncearcă fails again, and recovers after', async () => {
    const list = jest
      .fn()
      .mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }))
      .mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }))
      .mockResolvedValueOnce({
        items: [row('r-1', '2025-03-12')],
        truncated: false,
      });
    await mount({ list });
    const retry = () =>
      [...element.querySelectorAll('button')].find(
        (b) => text(b) === 'Reîncearcă',
      ) as HTMLButtonElement;

    retry().click();
    await settle();
    expect(retry()).toBeDefined();
    retry().click();
    await settle();

    expect(rows()).toHaveLength(1);
  });

  it('sorts nothing: rows stay in the answered order even when dates run oldest first', async () => {
    await mount({
      list: jest.fn(async () => ({
        items: [row('a', '2020-01-01'), row('b', '2025-01-01')],
        truncated: false,
      })),
    });

    expect(rows()).toEqual([
      '1 ian. 2020 · Dacia Logan 2018 Deschide',
      '1 ian. 2025 · Dacia Logan 2018 Deschide',
    ]);
  });
});
