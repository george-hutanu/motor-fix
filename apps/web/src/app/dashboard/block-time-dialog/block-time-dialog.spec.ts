import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { todayInBucharest } from '@motor-fix/contracts/garage-hours';
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
import { nextQuarter } from '../bucharest-time';
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
const WINTER = '2030-01-17';
const DAY = 24 * 3_600_000;

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
const text = () => (panel()?.textContent ?? '').replace(/\s+/g, ' ');
const button = (name: string) =>
  [...panel().querySelectorAll('button')].find(
    (b) => b.textContent?.replace(/\s+/g, ' ').trim() === name,
  ) as HTMLButtonElement | undefined;
const control = <T extends HTMLElement = HTMLInputElement>(id: string) =>
  panel()?.querySelector<T>(`#mf-block-${id}`) ?? null;
const mechanic = () => control<HTMLSelectElement>('mechanic');
const lift = () => control<HTMLSelectElement>('lift');
const choices = (el: HTMLSelectElement | null) =>
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

// @traces 1403-FR-003
// @traces 1403-FR-009
describe('the block-time dialog: what it draws', () => {
  it('reads the options once for the garage and offers the mechanics and lifts, none first', async () => {
    await open();

    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith({ garageId: 'garage-1' });
    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Blochează timp',
    );
    expect(choices(mechanic())).toEqual([
      'Fără mecanic',
      'Ion Popescu',
      'Maria Ionescu',
    ]);
    expect(mechanic()?.value).toBe('');
    expect(choices(lift())).toEqual([
      'Fără elevator',
      'Elevator 1',
      'Elevator 2',
    ]);
    expect(lift()?.value).toBe('');
    for (const label of ['Mecanic', 'Elevator', 'De la', 'Până la', 'Notă'])
      expect(text()).toContain(label);
  });

  it('labels every control', async () => {
    await open();

    for (const id of [
      'mechanic',
      'lift',
      'from-day',
      'from-time',
      'until-day',
      'until-time',
      'note',
    ]) {
      const el = control(id) as HTMLElement;
      const label = panel().querySelector(`label[for="mf-block-${id}"]`);
      expect(
        label?.textContent?.trim() || el.getAttribute('aria-label'),
      ).toBeTruthy();
    }
  });

  it('starts at the next quarter hour today and ends an hour later', async () => {
    const before = nextQuarter();
    await open();
    const after = nextQuarter();

    const from = control('from-time')?.value ?? '';
    expect([before, after]).toContain(from);
    expect(control('from-day')?.value).toBe(todayInBucharest());
    const [hh, mm] = from.split(':').map(Number);
    const end = hh * 60 + mm + 60;
    expect(control('until-time')?.value).toBe(
      `${String(Math.floor(end / 60) % 24).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`,
    );
    expect(control('from-time')?.getAttribute('step')).toBe('900');
    expect(control('until-time')?.getAttribute('step')).toBe('900');
  });

  it('takes a note of at most 200 characters and says how many are left', async () => {
    await open();

    const note = control<HTMLTextAreaElement>('note');
    expect(note?.tagName).toBe('TEXTAREA');
    expect(note?.maxLength).toBe(200);
    expect(text()).toContain('Rămase: 200');
    await set('note', 'Client');
    expect(text()).toContain('Rămase: 194');
  });

  it('puts the focus on the first field once the options arrive, on a computer', async () => {
    const media = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      addEventListener: () => undefined,
      addListener: () => undefined,
      dispatchEvent: () => false,
      matches: true,
      media: query,
      onchange: null,
      removeEventListener: () => undefined,
      removeListener: () => undefined,
    })) as typeof window.matchMedia;
    try {
      await open();

      expect(document.activeElement).toBe(mechanic());
    } finally {
      window.matchMedia = media;
    }
  });

  it('keeps the fields and Blochează off while the options load', async () => {
    await open({ reads: jest.fn(() => new Promise(() => undefined)) });

    expect(text()).toContain('Se încarcă…');
    expect(button('Blochează')?.disabled).toBe(true);
    expect(control('from-day')?.disabled).toBe(true);
    expect(control<HTMLTextAreaElement>('note')?.disabled).toBe(true);
  });

  it('says a failed read with Reîncearcă, the fields off, and reads again on it', async () => {
    const reads = jest
      .fn()
      .mockRejectedValueOnce(refusal(500, {}))
      .mockResolvedValueOnce(OPTIONS);
    await open({ reads });

    expect(problem()).toBe('Ceva nu a mers. Încearcă din nou.');
    expect(button('Blochează')?.disabled).toBe(true);
    expect(control('from-day')?.disabled).toBe(true);

    await press('Reîncearcă');

    expect(reads).toHaveBeenCalledTimes(2);
    expect(problem()).toBe('');
    expect(button('Blochează')?.disabled).toBe(false);
    expect(choices(mechanic())).toContain('Ion Popescu');
  });

  it('reads in English', async () => {
    await open({ language: 'en' });

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe('Block time');
    expect(choices(mechanic())[0]).toBe('No mechanic');
    expect(choices(lift())).toEqual(['No lift', 'Lift 1', 'Lift 2']);
    for (const label of ['Mechanic', 'Lift', 'From', 'Until', 'Note'])
      expect(text()).toContain(label);
    expect(button('Block')).toBeDefined();
    expect(button('Cancel')).toBeDefined();
    expect(text()).toContain('Left: 200');
  });
});

// @traces 1403-FR-003
// @traces 1403-FR-005
describe('the block-time dialog: the fields follow the switches', () => {
  it('draws no Mecanic with the team off, and sends no mechanicId', async () => {
    await open({ team: false });

    expect(mechanic()).toBeNull();
    expect(lift()).not.toBeNull();
    await set('lift', '1');
    await when(SUMMER, '10:00', SUMMER, '11:00');
    await press();

    expect(create.mock.calls[0][0].body).not.toHaveProperty('mechanicId');
  });

  it('draws no Elevator with the lifts off, and sends no lift', async () => {
    await open({ lifts: false });

    expect(lift()).toBeNull();
    await set('mechanic', 'mech-1');
    await when(SUMMER, '10:00', SUMMER, '11:00');
    await press();

    expect(create.mock.calls[0][0].body).not.toHaveProperty('lift');
  });

  it('draws no Elevator when the garage counts no lift', async () => {
    await open({ offered: { ...OPTIONS, liftCount: 0 } });

    expect(lift()).toBeNull();
    expect(mechanic()).not.toBeNull();
  });

  it('says the team has no mechanic yet, links the team, and still blocks a lift', async () => {
    await open({ offered: { liftCount: 2, mechanics: [] } });

    expect(choices(mechanic())).toEqual(['Fără mecanic']);
    expect(text()).toContain('Nu ai încă mecanici în echipă.');
    const link = [...panel().querySelectorAll('a')].find(
      (a) => a.textContent?.trim() === 'Deschide echipa',
    );
    expect(link?.getAttribute('href')).toBe('/app/garage/team');

    await set('lift', '2');
    await when(SUMMER, '10:00', SUMMER, '11:00');
    await press();

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].body.lift).toBe(2);
  });

  it('gives a receptionist the team line without the link', async () => {
    await open({ capabilities: [], offered: { liftCount: 2, mechanics: [] } });

    expect(text()).toContain('Nu ai încă mecanici în echipă.');
    expect(text()).not.toContain('Deschide echipa');
  });

  it('says it in English', async () => {
    await open({ language: 'en', offered: { liftCount: 2, mechanics: [] } });

    expect(text()).toContain('No mechanics on the team yet.');
    expect(text()).toContain('Open the team');
  });
});

// @traces 1403-FR-004
// @traces 1403-FR-009
describe('the block-time dialog: what it refuses before sending', () => {
  it('asks for a mechanic or a lift under Mecanic when both are drawn', async () => {
    await open();
    await when(SUMMER, '10:00', SUMMER, '11:00');

    await press();

    expect(create).not.toHaveBeenCalled();
    expect(messageOf(mechanic())).toBe('Alege un mecanic sau un elevator');
    expect(mechanic()?.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(mechanic());
  });

  it('asks for a lift when only Elevator is drawn', async () => {
    await open({ team: false });
    await when(SUMMER, '10:00', SUMMER, '11:00');

    await press();

    expect(create).not.toHaveBeenCalled();
    expect(messageOf(lift())).toBe('Alege un elevator');
  });

  it('asks for a mechanic when only Mecanic is drawn', async () => {
    await open({ lifts: false });
    await when(SUMMER, '10:00', SUMMER, '11:00');

    await press();

    expect(messageOf(mechanic())).toBe('Alege un mecanic');
  });

  it('wants the end after the start, under Până la', async () => {
    await open();
    await set('mechanic', 'mech-1');
    await when(SUMMER, '11:00', SUMMER, '11:00');

    await press();

    expect(create).not.toHaveBeenCalled();
    expect(messageOf(control('until-time'))).toBe(
      'Sfârșitul trebuie să fie după început',
    );
    expect(control('until-time')?.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(control('until-day'));
  });

  it('wants the time on a quarter hour', async () => {
    await open();
    await set('mechanic', 'mech-1');
    await when(SUMMER, '10:10', SUMMER, '11:00');

    await press();

    expect(create).not.toHaveBeenCalled();
    expect(messageOf(control('from-time'))).toBe(
      'Ora trebuie să fie la un sfert de oră',
    );
  });

  it('blocks at most 14 days', async () => {
    await open();
    await set('mechanic', 'mech-1');
    await when('2030-07-01', '10:00', '2030-07-15', '10:15');

    await press();

    expect(create).not.toHaveBeenCalled();
    expect(messageOf(control('until-time'))).toBe('Cel mult 14 zile');
  });

  it('takes exactly 14 days', async () => {
    await open();
    await set('mechanic', 'mech-1');
    await when('2030-07-01', '10:00', '2030-07-15', '10:00');

    await press();

    expect(create).toHaveBeenCalledTimes(1);
  });

  it('refuses an interval already over, and sends one that started already', async () => {
    await open();
    await set('mechanic', 'mech-1');
    const yesterday = todayInBucharest(new Date(Date.now() - DAY));
    const tomorrow = todayInBucharest(new Date(Date.now() + DAY));
    await when(yesterday, '10:00', yesterday, '11:00');

    await press();

    expect(create).not.toHaveBeenCalled();
    expect(messageOf(control('until-time'))).toBe(
      'Intervalul s‑a încheiat deja',
    );

    await when(yesterday, '10:00', tomorrow, '11:00');
    await press();

    expect(create).toHaveBeenCalledTimes(1);
  });

  it('wants a day and a time in a cleared field', async () => {
    await open();
    await set('mechanic', 'mech-1');
    await when(SUMMER, '10:00', SUMMER, '11:00');
    await set('from-time', '');

    await press();

    expect(create).not.toHaveBeenCalled();
    expect(messageOf(control('from-time'))).toBe('Alege ziua și ora');
  });

  it('clears a message once its field changes', async () => {
    await open();
    await when(SUMMER, '10:00', SUMMER, '11:00');
    await press();

    await set('mechanic', 'mech-1');

    expect(messageOf(mechanic())).toBe('');
    expect(mechanic()?.getAttribute('aria-invalid')).toBeNull();
  });

  it('says it in English', async () => {
    await open({ language: 'en' });
    await when(SUMMER, '10:00', SUMMER, '11:00');
    await press('Block');

    expect(messageOf(mechanic())).toBe('Pick a mechanic or a lift');

    await set('mechanic', 'mech-1');
    await when(SUMMER, '11:00', SUMMER, '10:00');
    await press('Block');

    expect(messageOf(control('until-time'))).toBe(
      'The end must be after the start',
    );
  });
});

// @traces 1403-FR-005
describe('the block-time dialog: saving a new block', () => {
  it('sends the mechanic, the lift, the Bucharest instants and the trimmed note, then closes', async () => {
    await open();
    await set('mechanic', 'mech-2');
    await set('lift', '2');
    await when(SUMMER, '10:00', SUMMER, '11:30');
    await set('note', '  Client la telefon: Ford Focus, plăcuțe  ');

    await press();

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toEqual({
      body: {
        endsAt: '2030-07-11T11:30:00+03:00',
        lift: 2,
        mechanicId: 'mech-2',
        note: 'Client la telefon: Ford Focus, plăcuțe',
        startsAt: '2030-07-11T10:00:00+03:00',
      },
      garageId: 'garage-1',
    });
    await expect(result).resolves.toBe('blocked');
    expect(toast).toHaveBeenCalledWith('Interval blocat');
  });

  it('sends a winter day with +02:00, and no mechanic or note left empty', async () => {
    await open();
    await set('lift', '1');
    await when(WINTER, '16:00', '2030-01-18', '10:00');
    await set('note', '   ');

    await press();

    expect(create.mock.calls[0][0].body).toEqual({
      endsAt: '2030-01-18T10:00:00+02:00',
      lift: 1,
      startsAt: '2030-01-17T16:00:00+02:00',
    });
  });

  it('says Time blocked in English', async () => {
    await open({ language: 'en' });
    await set('mechanic', 'mech-1');
    await when(SUMMER, '10:00', SUMMER, '11:00');

    await press('Block');

    expect(toast).toHaveBeenCalledWith('Time blocked');
  });

  it('is busy while the save is in flight: a second press sends nothing and closing waits', async () => {
    await open();
    let answer: (block: TimeBlockDto) => void = () => undefined;
    create.mockImplementation(
      () => new Promise<TimeBlockDto>((resolve) => (answer = resolve)),
    );
    await set('mechanic', 'mech-1');
    await when(SUMMER, '10:00', SUMMER, '11:00');

    await press();
    await press();

    expect(create).toHaveBeenCalledTimes(1);
    const submit = button('Blochează');
    expect(submit?.getAttribute('aria-busy')).toBe('true');
    expect(submit?.disabled).toBe(true);
    expect(button('Renunță')?.disabled).toBe(true);
    mechanic()?.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    document
      .querySelector<HTMLElement>('.cdk-overlay-backdrop')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(settled).toBeUndefined();
    expect(panel()).not.toBeNull();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();

    answer(BLOCK);
    await settle();

    await expect(result).resolves.toBe('blocked');
  });
});

// @traces 1403-FR-006
describe('the block-time dialog: what the server refuses', () => {
  async function refusedWith(error: HttpErrorResponse, reread = OPTIONS) {
    const reads = jest
      .fn()
      .mockResolvedValueOnce(OPTIONS)
      .mockResolvedValue(reread);
    await open({ reads });
    create.mockRejectedValue(error);
    await set('mechanic', 'mech-1');
    await set('lift', '2');
    await when(SUMMER, '10:00', SUMMER, '11:30');
    await press();
    return reads;
  }

  it('draws the options of the latest read when an earlier one answers last', async () => {
    let first: (offered: TimeBlockOptionsDto) => void = () => undefined;
    const reads = jest
      .fn()
      .mockResolvedValueOnce(OPTIONS)
      .mockImplementationOnce(
        () => new Promise<TimeBlockOptionsDto>((resolve) => (first = resolve)),
      )
      .mockResolvedValue({ ...OPTIONS, liftCount: 1 });
    await open({ reads });
    create.mockRejectedValue(
      refusal(409, {
        code: 'slot_taken',
        message: 'Locul tocmai a fost ocupat',
      }),
    );
    await set('mechanic', 'mech-1');
    await when(SUMMER, '10:00', SUMMER, '11:30');
    await press();
    await press();

    first(OPTIONS);
    await settle();

    expect(reads).toHaveBeenCalledTimes(3);
    expect(choices(lift())).toHaveLength(2);
  });

  it('says a busy mechanic under Mecanic, in the server’s words, and keeps every choice', async () => {
    const reads = await refusedWith(
      refusal(409, {
        code: 'mechanic_busy',
        errors: [{ code: 'busy', field: 'mechanicId' }],
        message: 'Ion Popescu e blocat 10:00–11:30',
      }),
    );

    expect(messageOf(mechanic())).toBe('Ion Popescu e blocat 10:00–11:30');
    expect(document.activeElement).toBe(mechanic());
    expect(mechanic()?.value).toBe('mech-1');
    expect(lift()?.value).toBe('2');
    expect(control('until-time')?.value).toBe('11:30');
    expect(reads).toHaveBeenCalledTimes(1);
    expect(settled).toBeUndefined();
  });

  it('says a busy lift under Elevator', async () => {
    await refusedWith(
      refusal(409, {
        code: 'lift_busy',
        errors: [{ code: 'busy', field: 'lift' }],
        message: 'Elevatorul 2 e ocupat 10:00–11:00 (Dacia Logan)',
      }),
    );

    expect(messageOf(lift())).toBe(
      'Elevatorul 2 e ocupat 10:00–11:00 (Dacia Logan)',
    );
    expect(document.activeElement).toBe(lift());
  });

  it('says a taken slot above the fields and reads the options again', async () => {
    const reads = await refusedWith(
      refusal(409, {
        code: 'slot_taken',
        message: 'Locul tocmai a fost ocupat',
      }),
    );

    expect(problem()).toBe('Locul tocmai a fost ocupat');
    expect(reads).toHaveBeenCalledTimes(2);
    expect(mechanic()?.value).toBe('mech-1');
  });

  it('says a mechanic gone from the team under Mecanic, in its own words, and reads again', async () => {
    const reads = await refusedWith(
      refusal(422, {
        code: 'validation_failed',
        errors: [{ code: 'invalid', field: 'mechanicId' }],
        message: 'mechanicId is not a card of this garage',
      }),
    );

    expect(messageOf(mechanic())).toBe('Mecanicul nu mai e în echipă');
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it('says a lift that does not exist under Elevator and reads again', async () => {
    const reads = await refusedWith(
      refusal(422, {
        code: 'validation_failed',
        errors: [{ code: 'invalid', field: 'lift' }],
        message: 'lift must be from 1 to 1',
      }),
    );

    expect(messageOf(lift())).toBe('Elevatorul nu există');
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it('says an end already over under Până la, in the server’s words', async () => {
    await refusedWith(
      refusal(422, {
        code: 'validation_failed',
        errors: [{ code: 'invalid', field: 'endsAt' }],
        message: 'Intervalul s‑a încheiat deja',
      }),
    );

    expect(messageOf(control('until-time'))).toBe(
      'Intervalul s‑a încheiat deja',
    );
  });

  it('says nothing to block above the fields and reads again', async () => {
    const reads = await refusedWith(
      refusal(422, {
        code: 'nothing_to_block',
        message: 'Nu e nimic de blocat: pornește echipa sau elevatoarele',
      }),
    );

    expect(problem()).toBe(
      'Nu e nimic de blocat: pornește echipa sau elevatoarele',
    );
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it('says a switch turned off in its own words, then draws no Elevator for no lift', async () => {
    const reads = await refusedWith(
      refusal(404, {
        code: 'feature_off',
        message: 'This garage schedules without lifts',
      }),
      { ...OPTIONS, liftCount: 0 },
    );

    expect(problem()).toBe('Programul garajului s‑a schimbat');
    expect(reads).toHaveBeenCalledTimes(2);
    expect(lift()).toBeNull();
    expect(mechanic()).not.toBeNull();
  });

  it('draws no Mecanic once the team was switched off under a sent mechanic', async () => {
    await refusedWith(
      refusal(404, {
        code: 'feature_off',
        message: 'This garage does not take mechanics',
      }),
      { liftCount: 2, mechanics: [] },
    );

    expect(mechanic()).toBeNull();
    expect(lift()).not.toBeNull();

    await press();

    expect(create.mock.calls[1][0].body).not.toHaveProperty('mechanicId');
  });

  it('says another refusal in the server’s words, else the shared text for its code', async () => {
    await refusedWith(refusal(409, { code: 'conflict' }));

    expect(problem()).toBe(
      'Altcineva a schimbat asta între timp. Reîncarcă pagina și încearcă din nou.',
    );

    create.mockRejectedValue(
      refusal(409, { code: 'something_new', message: 'Ceva anume' }),
    );
    await press();

    expect(problem()).toBe('Ceva anume');
  });
});

// @traces 1403-FR-007
describe('the block-time dialog: offline and a failed save', () => {
  async function failsWith(error: HttpErrorResponse, offline = false) {
    await open();
    create.mockRejectedValue(error);
    await set('mechanic', 'mech-1');
    await when(SUMMER, '10:00', SUMMER, '11:00');
    if (offline)
      Object.defineProperty(Navigator.prototype, 'onLine', {
        configurable: true,
        get: () => false,
      });
    await press();
  }

  it('says it is offline in a toast and keeps the dialog with every choice', async () => {
    await failsWith(refusal(0, {}), true);

    expect(toast).toHaveBeenCalledWith(
      'Nu ești conectat. Încearcă din nou când revine conexiunea.',
    );
    expect(settled).toBeUndefined();
    expect(mechanic()?.value).toBe('mech-1');
    expect(create).toHaveBeenCalledTimes(1);
    expect(button('Blochează')?.disabled).toBe(false);
  });

  it.each([
    ['a 5xx', 503],
    ['no answer', 0],
  ])('says the shared error text in a toast on %s', async (_, status) => {
    await failsWith(refusal(status, {}));

    expect(toast).toHaveBeenCalledWith('Ceva nu a mers. Încearcă din nou.');
    expect(settled).toBeUndefined();
    expect(control('until-time')?.value).toBe('11:00');
  });
});

// @traces 1403-FR-008
describe('the block-time dialog: changing a given block', () => {
  it('shows the block, Salvează and Elimină, titled for the change', async () => {
    await open({ block: BLOCK });

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Modifică intervalul blocat',
    );
    expect(mechanic()?.value).toBe('mech-1');
    expect(lift()?.value).toBe('2');
    expect(control('from-day')?.value).toBe(SUMMER);
    expect(control('from-time')?.value).toBe('10:00');
    expect(control('until-day')?.value).toBe(SUMMER);
    expect(control('until-time')?.value).toBe('11:30');
    expect(control<HTMLTextAreaElement>('note')?.value).toBe(
      'Client la telefon',
    );
    expect(button('Salvează')).toBeDefined();
    expect(button('Elimină')).toBeDefined();
    expect(button('Blochează')).toBeUndefined();
  });

  it('sends only the changed end, then closes', async () => {
    await open({ block: BLOCK });
    await set('until-time', '12:00');

    await press('Salvează');

    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toEqual({
      blockId: 'block-1',
      body: { endsAt: '2030-07-11T12:00:00+03:00' },
      garageId: 'garage-1',
    });
    await expect(result).resolves.toBe('changed');
    expect(toast).toHaveBeenCalledWith('Interval modificat');
  });

  it('sends a mechanic set back to none, and a cleared note, as null', async () => {
    await open({ block: BLOCK });
    await set('mechanic', '');
    await set('note', '');

    await press('Salvează');

    expect(update.mock.calls[0][0].body).toEqual({
      mechanicId: null,
      note: null,
    });
  });

  it('sends nothing and closes when nothing changed', async () => {
    await open({ block: BLOCK });

    await press('Salvează');

    expect(update).not.toHaveBeenCalled();
    await expect(result).resolves.toBe('cancelled');
  });

  it('refuses before sending as a new block does', async () => {
    await open({ block: BLOCK });
    await set('until-time', '09:00');

    await press('Salvează');

    expect(update).not.toHaveBeenCalled();
    expect(messageOf(control('until-time'))).toBe(
      'Sfârșitul trebuie să fie după început',
    );
  });

  it('asks before removing, and goes back on Renunță', async () => {
    await open({ block: BLOCK });

    await press('Elimină');

    const question = panel().querySelector('.question [role="alert"]');
    expect(question?.textContent?.trim()).toBe('Elimini intervalul blocat?');
    expect(remove).not.toHaveBeenCalled();

    await press('Renunță');

    expect(panel().querySelector('.question')).toBeNull();
    expect(button('Salvează')).toBeDefined();
    expect(settled).toBeUndefined();
  });

  it('removes on yes, then closes', async () => {
    await open({ block: BLOCK });
    await press('Elimină');

    await press('Elimină');

    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith({
      blockId: 'block-1',
      garageId: 'garage-1',
    });
    await expect(result).resolves.toBe('removed');
    expect(toast).toHaveBeenCalledWith('Interval eliminat');
  });

  it('says a past block above the fields and closes refused on Renunță', async () => {
    await open({ block: BLOCK });
    update.mockRejectedValue(
      refusal(409, {
        code: 'block_past',
        message: 'Un interval blocat trecut nu se mai poate modifica',
      }),
    );
    await set('until-time', '12:00');
    await press('Salvează');

    expect(problem()).toBe(
      'Un interval blocat trecut nu se mai poate modifica',
    );
    expect(settled).toBeUndefined();

    await press('Renunță');

    await expect(result).resolves.toBe('refused');
  });

  it('says a block removed meanwhile in the shared words and closes refused', async () => {
    await open({ block: BLOCK });
    remove.mockRejectedValue(
      refusal(404, { code: 'not_found', message: 'No such blocked interval' }),
    );
    await press('Elimină');
    await press('Elimină');

    expect(problem()).toBe(
      'Nu mai găsim ce voiai să salvezi. Reîncarcă pagina.',
    );

    await press('Renunță');

    await expect(result).resolves.toBe('refused');
  });

  it('reads in English', async () => {
    await open({ block: BLOCK, language: 'en' });

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Change the blocked time',
    );
    expect(button('Save')).toBeDefined();
    await press('Remove');
    expect(text()).toContain('Remove the blocked time?');
  });
});
