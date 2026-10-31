import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  GaragesService,
  type TimeBlockDto,
  type TimeBlockOptionsDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { toast } from '@motor-fix/ui-cockpit';

import { BlockTimeDialog } from './block-time-dialog';
import type { BlockTimeData, BlockTimeResult } from './open-block-time';
import { Session } from '../session';

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: jest.fn(),
}));

@Component({
  template: '<button type="button" id="opener">Blochează timp</button>',
})
class Host {
  readonly overlays = inject(Overlays);
}

const OPTIONS: TimeBlockOptionsDto = {
  liftCount: 2,
  mechanics: [
    { id: 'mech-1', name: 'Ion Popescu' },
    { id: 'mech-2', name: 'Maria Ionescu' },
  ],
};

// A summer day and a winter day well ahead.
const SUMMER = '2030-07-11';
const _WINTER = '2030-01-17';
const _DAY = 24 * 3_600_000;

const BLOCK: TimeBlockDto = {
  endsAt: '2030-07-11T08:30:00.000Z',
  id: 'block-1',
  lift: 2,
  mechanic: { id: 'mech-1', name: 'Ion Popescu' },
  note: 'Client la telefon',
  segments: [],
  startsAt: '2030-07-11T07:00:00.000Z',
};

let read: jest.Mock;
let create: jest.Mock;
let update: jest.Mock;
let remove: jest.Mock;
let result: Promise<BlockTimeResult | 'cancelled'>;
let settled: BlockTimeResult | 'cancelled' | undefined;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open({
  block,
  capabilities = ['garage.team'],
  language = 'ro',
  lifts = true,
  offered = OPTIONS,
  reads,
  team = true,
}: {
  block?: TimeBlockDto;
  capabilities?: string[];
  language?: 'ro' | 'en';
  lifts?: boolean;
  offered?: TimeBlockOptionsDto;
  reads?: jest.Mock;
  team?: boolean;
} = {}) {
  read = reads ?? jest.fn(async () => offered);
  create = jest.fn(async () => ({ ...BLOCK, id: 'block-2' }));
  update = jest.fn(async () => BLOCK);
  remove = jest.fn(async () => undefined);
  settled = undefined;
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ children: [], path: '**' }]),
      { provide: Session, useValue: { shown: () => ({ capabilities }) } },
      {
        provide: GaragesService,
        useValue: {
          createTimeBlock: create,
          deleteTimeBlock: remove,
          timeBlockOptions: read,
          updateTimeBlock: update,
        },
      },
    ],
  });
  await TestBed.inject(I18n).enter('garage');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  document.body.appendChild(host.nativeElement);
  (host.nativeElement as HTMLElement)
    .querySelector<HTMLButtonElement>('#opener')
    ?.focus();
  result = host.componentInstance.overlays.open<BlockTimeResult, BlockTimeData>(
    BlockTimeDialog,
    {
      data: { block, garageId: 'garage-1', lifts, team },
      shape: 'dialog',
      title: block ? 'garage.timeBlocks.titleEdit' : 'garage.timeBlocks.title',
    },
  );
  const mine = result;
  void mine.then((r) => {
    if (result === mine) settled = r;
  });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const _text = () => (panel()?.textContent ?? '').replace(/\s+/g, ' ');
const button = (name: string) =>
  [...panel().querySelectorAll('button')].find(
    (b) => b.textContent?.replace(/\s+/g, ' ').trim() === name,
  ) as HTMLButtonElement | undefined;
const control = <T extends HTMLElement = HTMLInputElement>(id: string) =>
  panel()?.querySelector<T>(`#mf-block-${id}`) ?? null;
const mechanic = () => control<HTMLSelectElement>('mechanic');
const lift = () => control<HTMLSelectElement>('lift');
const _choices = (el: HTMLSelectElement | null) =>
  [...(el?.options ?? [])].map((o) => o.textContent?.trim());
const problem = () =>
  panel().querySelector('.problem')?.textContent?.replace(/\s+/g, ' ').trim() ??
  '';

// The message a control points at, announced as it appears.
function messageOf(el: HTMLElement | null) {
  const ids = el?.getAttribute('aria-describedby')?.split(' ') ?? [];
  const said = ids
    .map((id) => document.getElementById(id))
    .find((m) => m?.getAttribute('role') === 'alert' && m.textContent?.trim());
  return said?.textContent?.trim() ?? '';
}

async function set(id: string, value: string) {
  const el = control<HTMLInputElement | HTMLSelectElement>(id);
  if (!el) throw new Error(`no #mf-block-${id}`);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
}

async function when(
  fromDay: string,
  from: string,
  untilDay: string,
  until: string,
) {
  await set('from-day', fromDay);
  await set('from-time', from);
  await set('until-day', untilDay);
  await set('until-time', until);
}

const press = async (name = 'Blochează') => {
  button(name)?.click();
  await settle();
};

const refusal = (status: number, body: Record<string, unknown>) =>
  new HttpErrorResponse({ error: body, status });

const online = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  (toast as unknown as jest.Mock).mockClear();
  if (online) Object.defineProperty(Navigator.prototype, 'onLine', online);
  TestBed.resetTestingModule();
});

// @traces 1403-FR-004
describe('the block-time dialog: hostile input', () => {
  it('takes an interval of exactly 15 minutes', async () => {
    await open();
    await set('mechanic', 'mech-1');
    await when(SUMMER, '10:00', SUMMER, '10:15');

    await press();

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].body.endsAt).toBe(
      '2030-07-11T10:15:00+03:00',
    );
  });

  it('refuses a note of 201 characters set past the textarea’s maxlength', async () => {
    await open();
    await set('mechanic', 'mech-1');
    await when(SUMMER, '10:00', SUMMER, '11:00');
    await set('note', 'a'.repeat(201));

    await press();

    expect(create).not.toHaveBeenCalled();
    expect(settled).toBeUndefined();
  });

  it('sends a note of exactly 200 characters whole', async () => {
    await open();
    await set('mechanic', 'mech-1');
    await when(SUMMER, '10:00', SUMMER, '11:00');
    await set('note', 'ș'.repeat(200));

    await press();

    expect(create.mock.calls[0][0].body.note).toBe('ș'.repeat(200));
  });

  it('trims a no-break space and keeps emoji and right-to-left text inside the note', async () => {
    await open();
    await set('mechanic', 'mech-1');
    await when(SUMMER, '10:00', SUMMER, '11:00');
    await set('note', '  🚗 مرحبا \n');

    await press();

    expect(create.mock.calls[0][0].body.note).toBe('🚗 مرحبا');
  });

  it('refuses a start on a Bucharest day that is not a real date', async () => {
    await open();
    await set('mechanic', 'mech-1');
    await when('2030-02-30', '10:00', SUMMER, '11:00');

    await press();

    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a time with seconds that is off the quarter', async () => {
    await open();
    await set('mechanic', 'mech-1');
    await when(SUMMER, '10:00', SUMMER, '11:00');
    await set('until-time', '11:00:30');

    await press();

    expect(create).not.toHaveBeenCalled();
  });

  it('keeps a mechanic and a lift left on none out of the body while the note is a single space', async () => {
    await open({ team: false });
    await set('lift', '1');
    await when(SUMMER, '10:00', SUMMER, '11:00');
    await set('note', ' ');

    await press();

    expect(create.mock.calls[0][0].body).toEqual({
      endsAt: '2030-07-11T11:00:00+03:00',
      lift: 1,
      startsAt: '2030-07-11T10:00:00+03:00',
    });
  });
});

// @traces 1403-FR-006
describe('the block-time dialog: hostile refusal bodies', () => {
  async function refusedWith(error: HttpErrorResponse, reads?: jest.Mock) {
    await open({ reads });
    create.mockRejectedValue(error);
    await set('mechanic', 'mech-1');
    await set('lift', '2');
    await when(SUMMER, '10:00', SUMMER, '11:30');
    await press();
  }

  it.each([
    ['a null body', null],
    [
      'an empty errors list',
      { code: 'mechanic_busy', errors: [], message: 'Ocupat' },
    ],
    ['errors that is not a list', { code: 'x', errors: 'mechanicId' }],
    [
      'a field nobody draws',
      { code: 'validation_failed', errors: [{ code: 'x', field: 'zzz' }] },
    ],
    ['a string body', 'gateway timeout'],
  ])('keeps the dialog and every choice on a 409 with %s', async (_, body) => {
    await refusedWith(new HttpErrorResponse({ error: body, status: 409 }));

    expect(settled).toBeUndefined();
    expect(panel()).not.toBeNull();
    expect(mechanic()?.value).toBe('mech-1');
    expect(lift()?.value).toBe('2');
    expect(control('until-time')?.value).toBe('11:30');
    expect(button('Blochează')?.disabled).toBe(false);
    expect(problem().length).toBeGreaterThan(0);
  });

  it('shows a server message as text, never as markup', async () => {
    const hostile = '<img src=x onerror="window.__hit=1">Ocupat';
    await refusedWith(
      refusal(409, {
        code: 'mechanic_busy',
        errors: [{ code: 'busy', field: 'mechanicId' }],
        message: hostile,
      }),
    );

    expect(messageOf(mechanic())).toBe(hostile);
    expect(panel().querySelector('img')).toBeNull();
  });

  it('keeps every choice when the options re-read after a taken slot fails too', async () => {
    const reads = jest
      .fn()
      .mockResolvedValueOnce(OPTIONS)
      .mockRejectedValue(refusal(500, {}));
    await refusedWith(
      refusal(409, {
        code: 'slot_taken',
        message: 'Locul tocmai a fost ocupat',
      }),
      reads,
    );

    expect(panel()).not.toBeNull();
    expect(control('until-time')?.value).toBe('11:30');
    expect(settled).toBeUndefined();
    expect(button('Blochează')).toBeDefined();
  });

  it('sends the same body again on a second press after a failed save, and closes once', async () => {
    await open();
    create
      .mockRejectedValueOnce(refusal(503, {}))
      .mockResolvedValueOnce({ ...BLOCK, id: 'block-9' });
    await set('mechanic', 'mech-1');
    await when(SUMMER, '10:00', SUMMER, '11:00');

    await press();
    await press();

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0]).toEqual(create.mock.calls[0][0]);
    await expect(result).resolves.toBe('blocked');
    expect(toast).toHaveBeenCalledTimes(2);
  });

  it('shows the error toast on a 500 whose body names a field, not a refusal under it', async () => {
    await refusedWith(
      refusal(500, {
        errors: [{ code: 'busy', field: 'mechanicId' }],
        message: 'boom',
      }),
    );

    expect(toast).toHaveBeenCalledWith('Ceva nu a mers. Încearcă din nou.');
    expect(messageOf(mechanic())).toBe('');
  });
});

// @traces 1403-FR-008
describe('the block-time dialog: changing a block the options do not match', () => {
  it('sends nothing for a block whose mechanic left the team, when nothing changed', async () => {
    await open({
      block: { ...BLOCK, mechanic: { id: 'gone', name: 'Fost Coleg' } },
    });

    await press('Salvează');

    expect(update).not.toHaveBeenCalled();
    await expect(result).resolves.toBe('cancelled');
  });

  it('sends nothing for a block on a lift above the current count, when nothing changed', async () => {
    await open({
      block: { ...BLOCK, lift: 5 },
      offered: { ...OPTIONS, liftCount: 2 },
    });

    await press('Salvează');

    expect(update).not.toHaveBeenCalled();
  });

  it('sends no mechanicId null for a block with a mechanic when the team is off and only the end changed', async () => {
    await open({ block: BLOCK, team: false });
    await set('until-time', '12:00');

    await press('Salvează');

    expect(update.mock.calls[0][0].body).toEqual({
      endsAt: '2030-07-11T12:00:00+03:00',
    });
  });

  it('sends nothing for a block with neither mechanic nor lift and no note, unchanged', async () => {
    await open({ block: { ...BLOCK, lift: null, mechanic: null, note: null } });

    await press('Salvează');

    expect(update).not.toHaveBeenCalled();
  });

  it('counts a note that differs only by surrounding spaces as unchanged', async () => {
    await open({ block: BLOCK });
    await set('note', '  Client la telefon  ');

    await press('Salvează');

    expect(update).not.toHaveBeenCalled();
  });

  it('sends a note of only spaces as null', async () => {
    await open({ block: BLOCK });
    await set('note', '   ');

    await press('Salvează');

    expect(update.mock.calls[0][0].body).toEqual({ note: null });
  });

  it('shows a winter block on the Bucharest clock whatever the browser zone', async () => {
    await open({
      block: {
        ...BLOCK,
        endsAt: '2030-01-17T22:30:00.000Z',
        startsAt: '2030-01-17T21:30:00.000Z',
      },
    });

    expect(control('from-day')?.value).toBe('2030-01-17');
    expect(control('from-time')?.value).toBe('23:30');
    expect(control('until-day')?.value).toBe('2030-01-18');
    expect(control('until-time')?.value).toBe('00:30');
  });

  it('removes once when Elimină is pressed twice while the delete is in flight', async () => {
    await open({ block: BLOCK });
    remove.mockImplementation(() => new Promise(() => undefined));
    await press('Elimină');

    await press('Elimină');
    await press('Elimină');

    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('keeps the block and says the error on a failed delete, then removes on the next try', async () => {
    await open({ block: BLOCK });
    remove
      .mockRejectedValueOnce(refusal(503, {}))
      .mockResolvedValueOnce(undefined);
    await press('Elimină');
    await press('Elimină');

    expect(toast).toHaveBeenCalledWith('Ceva nu a mers. Încearcă din nou.');
    expect(settled).toBeUndefined();

    await press('Elimină');
    await press('Elimină');

    expect(remove).toHaveBeenCalledTimes(2);
    await expect(result).resolves.toBe('removed');
  });
});

// @traces 1403-FR-004
describe('the block-time dialog: closing', () => {
  it('closes at once on Renunță with nothing typed', async () => {
    await open();

    await press('Renunță');

    await expect(result).resolves.toBe('cancelled');
  });

  it('asks before closing on Renunță once a note is typed', async () => {
    await open();
    await set('note', 'x');

    await press('Renunță');

    expect(settled).toBeUndefined();
    expect(panel()).not.toBeNull();
  });

  it('asks before closing on Escape once a note is typed', async () => {
    await open();
    await set('note', 'x');

    control('note')?.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await settle();

    expect(settled).toBeUndefined();
    expect(
      panel().querySelector('.question, [role="alertdialog"]'),
    ).not.toBeNull();
  });
});
