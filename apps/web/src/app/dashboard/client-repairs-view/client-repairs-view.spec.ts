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
import { CorrectRepairDialog } from '../correct-repair-dialog/correct-repair-dialog';
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

// @traces 1400-FR-001 1400-FR-002
describe('Reparații adăugate de clienți, the list', () => {
  it("reads the owner's shared repairs once and shows a row per repair in the API's order", async () => {
    const { element, settle } = await render();
    await settle();

    expect(list).toHaveBeenCalledTimes(1);
    expect(rows(element).map((row) => row.dataset['repair'])).toEqual([
      'repair-1',
      'repair-2',
    ]);
  });

  it('reads each row as client · car · what · day · km · lei, with Corectează', async () => {
    const { element, settle } = await render();
    await settle();

    const [andrei] = rows(element);
    expect(text(andrei)).toContain('Andrei M.');
    expect(text(andrei)).toContain('VW Golf 2015');
    expect(text(andrei)).toContain('Schimb ulei și filtre');
    expect(text(andrei)).toContain('12 mart. 2025');
    expect(text(andrei)).toContain('141.300 km');
    expect(text(andrei)).toContain('450 lei');
    expect(text(correctOf(andrei))).toBe('Corectează');
  });

  it('says "fără sumă" for a repair without an amount', async () => {
    const { element, settle } = await render();
    await settle();

    const maria = rows(element)[1];
    expect(text(maria)).toContain('fără sumă');
    expect(text(maria)).not.toContain('lei');
  });

  it('adds "Corectată pe <day>" only to a repair the garage corrected', async () => {
    const { element, settle } = await render(async () =>
      listOf([repair({ correctedAt: '2026-10-29T10:00:00.000Z' }), SECOND]),
    );
    await settle();

    const [andrei, maria] = rows(element);
    expect(text(andrei.querySelector('.corrected'))).toBe(
      'Corectată pe 29 oct. 2026',
    );
    expect(maria.querySelector('.corrected')).toBeNull();
  });

  it('reads in English', async () => {
    const { element, settle } = await render(
      async () =>
        listOf([repair({ correctedAt: '2026-10-29T10:00:00.000Z' }), SECOND]),
      'en',
    );
    await settle();

    const [andrei, maria] = rows(element);
    expect(text(correctOf(andrei))).toBe('Correct');
    expect(text(andrei.querySelector('.corrected'))).toMatch(/^Corrected on /);
    expect(text(maria)).toContain('no amount');
  });

  it('names the repair on its button for a screen reader', async () => {
    const { element, settle } = await render();
    await settle();

    expect(correctOf(rows(element)[0])?.getAttribute('aria-label')).toBe(
      'Corectează reparația din 12 mart. 2025',
    );
  });

  it('offers no delete anywhere', async () => {
    const { element, settle } = await render();
    await settle();

    expect(text(element)).not.toMatch(/Șterge|Delete/);
  });

  it('shows the empty line when no client shares a repair', async () => {
    const { element, settle } = await render(async () => listOf([]));
    await settle();

    expect(rows(element)).toEqual([]);
    expect(text(element.querySelector('mf-empty-state'))).toContain(
      'Niciun client nu a partajat încă o reparație cu tine',
    );
  });

  it('shows the empty line, never an error, when the list answers 404', async () => {
    const { element, settle } = await render(async () => {
      throw gone();
    });
    await settle();

    expect(text(element.querySelector('mf-empty-state'))).toContain(
      'Niciun client nu a partajat încă o reparație cu tine',
    );
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });

  it('says only the newest 200 are shown when the list is truncated', async () => {
    const { element, settle } = await render(async () =>
      listOf([repair()], true),
    );
    await settle();

    expect(text(element.querySelector('[data-truncated]'))).toBe(
      'Se afișează cele mai noi 200 de reparații',
    );
  });

  it('says nothing of a limit when the list is whole', async () => {
    const { element, settle } = await render();
    await settle();

    expect(element.querySelector('[data-truncated]')).toBeNull();
  });

  it('says a first read failed and reads again on Reîncearcă', async () => {
    let calls = 0;
    const { element, settle } = await render(async () => {
      calls += 1;
      if (calls === 1) throw new HttpErrorResponse({ error: {}, status: 500 });
      return listOf([repair()]);
    });
    await settle();

    expect(text(element.querySelector('[role="alert"]'))).toBe(
      'Nu am putut încărca reparațiile',
    );
    element.querySelector<HTMLButtonElement>('button.retry')?.click();
    await settle();

    expect(rows(element)).toHaveLength(1);
  });

  it('shows placeholders while the first read is on its way', async () => {
    const { element, settle } = await render(() => new Promise(() => {}));
    await settle();

    expect(element.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(
      0,
    );
  });
});

// @traces 1400-FR-010
describe('Reparații adăugate de clienți, read again live', () => {
  it.each(['repair.updated', 'repair.shared', 'repair.unshared'])(
    'reads again on %s',
    async (kind) => {
      const { settle } = await render();
      await settle();

      events.next(message(kind));
      await wait(350);
      await settle();

      expect(list).toHaveBeenCalledTimes(2);
    },
  );

  it('drops the row of a repair its client stopped sharing at once', async () => {
    let shared = [repair(), SECOND];
    const { element, settle } = await render(async () => listOf(shared));
    await settle();

    shared = [SECOND];
    events.next(message('repair.unshared'));
    await wait(350);
    await settle();

    expect(rows(element).map((row) => row.dataset['repair'])).toEqual([
      'repair-2',
    ]);
  });

  it('reads again on a resync of the live channel', async () => {
    const { settle } = await render();
    await settle();

    resync.next();
    await settle();

    expect(list).toHaveBeenCalledTimes(2);
  });

  it('ignores an event of another kind', async () => {
    const { settle } = await render();
    await settle();

    events.next(message('repair.logged'));
    await wait(350);
    await settle();

    expect(list).toHaveBeenCalledTimes(1);
  });
});

// @traces 1400-FR-004 1400-FR-008 1400-FR-009
describe('Reparații adăugate de clienți, Corectează', () => {
  it('opens the correction dialog with the row', async () => {
    const { element, settle } = await render();
    await settle();

    correctOf(rows(element)[0])?.click();
    await settle();

    expect(open).toHaveBeenCalledTimes(1);
    const [source, options] = open.mock.calls[0];
    expect(source).toBe(CorrectRepairDialog);
    expect(options).toMatchObject({
      shape: 'dialog',
      title: 'garage.clientRepairs.correct.title',
    });
    expect(options.data.item).toEqual(repair());
  });

  it("gives the dialog a re-read of the owner's list that finds the repair by id", async () => {
    let current = repair();
    const { element, settle } = await render(async () =>
      listOf([current, SECOND]),
    );
    await settle();
    correctOf(rows(element)[0])?.click();
    await settle();

    current = repair({ odometerKm: 141_500, version: 'v2' });
    const found = await open.mock.calls[0][1].data.refresh();
    expect(found).toEqual(current);

    current = repair({ id: 'other' });
    expect(await open.mock.calls[0][1].data.refresh()).toBeUndefined();
  });

  it('updates the row in place with the saved repair', async () => {
    const saved = repair({
      correctedAt: '2026-10-30T09:00:00.000Z',
      odometerKm: 141_500,
    });
    const { element, settle } = await render();
    await settle();
    open.mockResolvedValueOnce(saved);

    correctOf(rows(element)[0])?.click();
    await settle();

    const [andrei] = rows(element);
    expect(text(andrei)).toContain('141.500 km');
    expect(text(andrei.querySelector('.corrected'))).toBe(
      'Corectată pe 30 oct. 2026',
    );
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('removes the row and says the client no longer shares it when the dialog ends unshared', async () => {
    const { element, settle } = await render();
    await settle();
    open.mockResolvedValueOnce('unshared');

    correctOf(rows(element)[0])?.click();
    await settle();

    expect(rows(element).map((row) => row.dataset['repair'])).toEqual([
      'repair-2',
    ]);
    expect(toast).toHaveBeenCalledWith(
      'Clientul nu mai partajează această reparație',
    );
  });

  it('changes nothing when the dialog is cancelled', async () => {
    const { element, settle } = await render();
    await settle();

    correctOf(rows(element)[0])?.click();
    await settle();

    expect(rows(element)).toHaveLength(2);
    expect(toast).not.toHaveBeenCalled();
  });

  it('shows the next read over a saved row once the list is read again', async () => {
    let odometerKm = 141_300;
    const { element, settle } = await render(async () =>
      listOf([repair({ odometerKm }), SECOND]),
    );
    await settle();
    open.mockResolvedValueOnce(repair({ odometerKm: 141_500 }));
    correctOf(rows(element)[0])?.click();
    await settle();

    odometerKm = 142_000;
    events.next(message('repair.updated'));
    await wait(350);
    await settle();

    expect(text(rows(element)[0])).toContain('142.000 km');
  });
});
