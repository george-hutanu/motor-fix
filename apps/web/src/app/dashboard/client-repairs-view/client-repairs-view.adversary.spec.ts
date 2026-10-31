import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  CarsService,
  type ClientRepairDto,
  type ClientRepairListDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { toast } from '@motor-fix/ui-cockpit';
import { filter, Subject } from 'rxjs';

import { ClientRepairsView } from './client-repairs-view';
import { Live } from '../live';

// The dialog is its own spec's; here it is only what the view opens.
jest.mock(
  '../correct-repair-dialog/correct-repair-dialog',
  () => ({ CorrectRepairDialog: class CorrectRepairDialog {} }),
  { virtual: true },
);
jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: jest.fn(),
}));

const repair = (over: Partial<ClientRepairDto> = {}): ClientRepairDto => ({
  car: { brandName: 'VW', model: 'Golf', year: 2015 },
  correctedAt: null,
  costBani: 45_000,
  doneOn: '2025-03-12',
  driver: { shortName: 'Andrei M.' },
  id: 'repair-1',
  odometerKm: 141_300,
  version: '2026-10-30T08:00:00.000Z',
  what: 'Schimb ulei și filtre',
  ...over,
});
const SECOND = repair({
  car: { brandName: 'Dacia', model: 'Logan', year: 2019 },
  costBani: null,
  doneOn: '2025-01-05',
  driver: { shortName: 'Maria P.' },
  id: 'repair-2',
  odometerKm: 88_000,
  what: 'Plăcuțe frână',
});
const listOf = (
  items: ClientRepairDto[],
  truncated = false,
): ClientRepairListDto => ({ items, truncated });

let events: Subject<LiveMessage>;
let resync: Subject<void>;
let list: jest.Mock;
let open: jest.Mock;

async function render(
  answer: () => Promise<ClientRepairListDto> = async () =>
    listOf([repair(), SECOND]),
  language: 'ro' | 'en' = 'ro',
) {
  events = new Subject();
  resync = new Subject();
  list = jest.fn(answer);
  open = jest.fn(async () => 'cancelled');
  TestBed.configureTestingModule({
    providers: [
      { provide: CarsService, useValue: { clientRepairsControllerList: list } },
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
  const fixture = TestBed.createComponent(ClientRepairsView);
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
  };
  return { element, settle };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const rows = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLElement>('[data-repair]'),
];
const correctOf = (row: HTMLElement) =>
  row.querySelector<HTMLButtonElement>('button[data-correct]');
const message = (kind: string, id = 'repair-1') =>
  ({ at: '2026-10-30T09:00:00.000Z', id, kind }) as LiveMessage;
const gone = () =>
  new HttpErrorResponse({ error: { code: 'not_found' }, status: 404 });

beforeEach(() => (toast as unknown as jest.Mock).mockClear());
afterEach(() => TestBed.resetTestingModule());

const pending = () => new Promise<never>(() => {});

// @traces 1400-FR-002
describe('Reparații adăugate de clienți, hostile rows', () => {
  it('reads a repair with no odometer without printing null or NaN', async () => {
    const { element, settle } = await render(async () =>
      listOf([repair({ odometerKm: null })]),
    );
    await settle();

    expect(text(rows(element)[0])).not.toMatch(/null|NaN|undefined/);
  });

  it('reads an odometer of zero as 0 km', async () => {
    const { element, settle } = await render(async () =>
      listOf([repair({ odometerKm: 0 })]),
    );
    await settle();

    expect(text(rows(element)[0])).toContain('0 km');
  });

  it('reads an amount of zero as 0 lei, not as no amount', async () => {
    const { element, settle } = await render(async () =>
      listOf([repair({ costBani: 0 })]),
    );
    await settle();

    expect(text(rows(element)[0])).toContain('0 lei');
    expect(text(rows(element)[0])).not.toContain('fără sumă');
  });

  it('shows markup in what was done as text', async () => {
    const { element, settle } = await render(async () =>
      listOf([repair({ what: '<img src=x onerror=alert(1)><b>x</b>' })]),
    );
    await settle();

    expect(element.querySelector('img')).toBeNull();
    expect(element.querySelector('b')).toBeNull();
    expect(text(rows(element)[0])).toContain('<img src=x onerror=alert(1)>');
  });

  it('shows markup in the client name as text', async () => {
    const { element, settle } = await render(async () =>
      listOf([repair({ driver: { shortName: '<script>x</script>' } })]),
    );
    await settle();

    expect(element.querySelector('script')).toBeNull();
    expect(text(rows(element)[0])).toContain('<script>x</script>');
  });

  it('shows 200 rows in order with the truncation line', async () => {
    const items = Array.from({ length: 200 }, (_, i) =>
      repair({ id: `r-${i}` }),
    );
    const { element, settle } = await render(async () => listOf(items, true));
    await settle();

    expect(rows(element).map((row) => row.dataset['repair'])).toEqual(
      items.map((item) => item.id),
    );
    expect(element.querySelector('[data-truncated]')).not.toBeNull();
  });

  it('shows the row of a deleted author with the label the API sends', async () => {
    const { element, settle } = await render(async () =>
      listOf([repair({ driver: { shortName: 'Cont șters' } })]),
    );
    await settle();

    expect(text(rows(element)[0])).toContain('Cont șters');
  });

  it('shows one empty line and no rows for a list answered with 404 after rows were shown', async () => {
    let first = true;
    const { element, settle } = await render(async () => {
      if (first) {
        first = false;
        return listOf([repair()]);
      }
      throw gone();
    });
    await settle();

    events.next(message('repair.unshared'));
    await wait(350);
    await settle();

    expect(rows(element)).toEqual([]);
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });
});

// @traces 1400-FR-010
describe('Reparații adăugate de clienți, live reads attacked', () => {
  it('keeps the rows on screen and shows no alert when a re-read fails', async () => {
    let calls = 0;
    const { element, settle } = await render(async () => {
      calls += 1;
      if (calls > 1) throw new HttpErrorResponse({ error: {}, status: 500 });
      return listOf([repair(), SECOND]);
    });
    await settle();

    events.next(message('repair.updated'));
    await wait(350);
    await settle();

    expect(rows(element)).toHaveLength(2);
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });

  it('does not close an open dialog when events arrive, and keeps asking one dialog at a time', async () => {
    open.mockImplementation(pending);
    const { element, settle } = await render();
    await settle();
    correctOf(rows(element)[0])?.click();
    await settle();

    events.next(message('repair.unshared'));
    await wait(350);
    await settle();

    expect(open).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('opens one dialog when Corectează is pressed twice quickly', async () => {
    const { element, settle } = await render();
    open.mockImplementation(pending);
    await settle();

    const button = correctOf(rows(element)[0]);
    button?.click();
    button?.click();
    await settle();

    expect(open).toHaveBeenCalledTimes(1);
  });

  it('reads at most twice for a burst of events', async () => {
    const { settle } = await render();
    await settle();

    for (let i = 0; i < 10; i++) events.next(message('repair.updated'));
    await wait(350);
    await settle();

    expect(list.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('stops reading after the view is destroyed', async () => {
    const { settle } = await render();
    await settle();
    TestBed.resetTestingModule();

    events.next(message('repair.updated'));
    resync.next();
    await wait(350);

    expect(list).toHaveBeenCalledTimes(1);
  });

  it('gives the dialog a re-read that answers undefined when the list is 404', async () => {
    let gonee = false;
    const { element, settle } = await render(async () => {
      if (gonee) throw gone();
      return listOf([repair()]);
    });
    await settle();
    correctOf(rows(element)[0])?.click();
    await settle();

    gonee = true;

    expect(await open.mock.calls[0][1].data.refresh()).toBeUndefined();
  });

  it('gives the dialog a re-read that does not answer a repair for a failing list', async () => {
    let fail = false;
    const { element, settle } = await render(async () => {
      if (fail) throw new HttpErrorResponse({ error: {}, status: 500 });
      return listOf([repair()]);
    });
    await settle();
    correctOf(rows(element)[0])?.click();
    await settle();
    fail = true;

    await expect(open.mock.calls[0][1].data.refresh()).rejects.toBeDefined();
  });
});

// @traces 1400-FR-008 1400-FR-009
describe('Reparații adăugate de clienți, dialog outcomes attacked', () => {
  it('says the client no longer shares it once, not per live read', async () => {
    const { element, settle } = await render();
    await settle();
    open.mockResolvedValueOnce('unshared');

    correctOf(rows(element)[0])?.click();
    await settle();
    events.next(message('repair.unshared'));
    await wait(350);
    await settle();

    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('keeps the other rows untouched when one row is saved', async () => {
    const { element, settle } = await render();
    await settle();
    open.mockResolvedValueOnce(repair({ odometerKm: 1 }));

    correctOf(rows(element)[0])?.click();
    await settle();

    expect(text(rows(element)[1])).toContain('88.000 km');
    expect(rows(element)).toHaveLength(2);
  });

  it('opens the dialog for the second row with the second item', async () => {
    const { element, settle } = await render();
    await settle();

    correctOf(rows(element)[1])?.click();
    await settle();

    expect(open.mock.calls[0][1].data.item.id).toBe('repair-2');
  });

  it('shows no delete control on any row in English', async () => {
    const { element, settle } = await render(
      async () => listOf([repair(), SECOND]),
      'en',
    );
    await settle();

    expect(element.querySelectorAll('button[data-correct]')).toHaveLength(2);
    expect(text(element)).not.toMatch(/Delete|Remove|Șterge/);
  });
});
