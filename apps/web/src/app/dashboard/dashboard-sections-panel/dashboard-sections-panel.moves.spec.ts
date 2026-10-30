import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import {
  DashboardSectionsPanel,
  type PanelRow,
  type SectionsPanelData,
} from './dashboard-sections-panel';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const row = (key: string, name: string): Omit<PanelRow, 'position'> => ({
  description: `${name}, pe scurt`,
  key,
  label: `Ascunde: ${name}`,
  name,
  shown: true,
});
const START = [
  row('numbers', 'Cifrele platformei'),
  row('growth', 'Creștere'),
  row('log', 'Jurnal'),
];
const placed = (rows: readonly Omit<PanelRow, 'position'>[]): PanelRow[] =>
  rows.map((each, i) => ({ ...each, position: i + 1 }));

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

// A dashboard whose moves apply to its rows at once and come back on a
// failed save, as the admin store does.
async function open(
  extra: {
    move?: (key: string, direction: 'up' | 'down') => Promise<boolean>;
    reset?: () => Promise<boolean>;
    withMoves?: boolean;
  } = {},
  language: 'ro' | 'en' = 'ro',
) {
  const order = signal(START);
  const rows = signal<readonly PanelRow[]>(placed(START));
  const apply = (key: string, direction: 'up' | 'down') => {
    const next = [...order()];
    const i = next.findIndex((each) => each.key === key);
    const j = direction === 'up' ? i - 1 : i + 1;
    [next[i], next[j]] = [next[j], next[i]];
    order.set(next);
    rows.set(placed(next));
  };
  const move = jest.fn(async (key: string, direction: 'up' | 'down') => {
    const before = order();
    apply(key, direction);
    const saved = extra.move ? await extra.move(key, direction) : true;
    if (!saved) {
      order.set(before);
      rows.set(placed(before));
    }
    return saved;
  });
  const reset = jest.fn(extra.reset ?? (async () => true));
  await TestBed.inject(I18n).enter('admin');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  const withMoves = extra.withMoves ?? true;
  host.componentInstance.overlays.open<'done', SectionsPanelData>(
    DashboardSectionsPanel,
    {
      confirmDiscard: false,
      data: {
        messages: 'admin.panel.sections',
        rows,
        toggle: async () => true,
        ...(withMoves ? { move, reset } : {}),
      },
      shape: 'drawer',
      title: 'admin.panel.sections.title',
    },
  );
  await settle();
  return { move, order, reset, rows };
}

const body = () =>
  document.querySelector('mf-dashboard-sections-panel') as HTMLElement;
const text = (el: Element | null) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const rowOf = (key: string) =>
  [...body().querySelectorAll<HTMLElement>('[data-row]')].find(
    (each) => each.getAttribute('data-key') === key,
  ) as HTMLElement;
const arrow = (key: string, direction: 'up' | 'down') =>
  rowOf(key).querySelector<HTMLButtonElement>(
    `[data-move="${direction}"]`,
  ) as HTMLButtonElement;
const keys = () =>
  [...body().querySelectorAll('[data-row]')].map((each) =>
    each.getAttribute('data-key'),
  );
const button = (label: string) =>
  [...body().querySelectorAll<HTMLButtonElement>('button')].find(
    (each) => text(each) === label,
  ) as HTMLButtonElement;
const alert = () => body().querySelector('[role="alert"]');

afterEach(() => {
  document.body.innerHTML = '';
  jest.restoreAllMocks();
});

// @traces 1391-FR-015
describe('a panel given no moves', () => {
  it('has no arrows and no reset, only the switches and "Gata"', async () => {
    await open({ withMoves: false });

    expect(body().querySelectorAll('[data-move]')).toHaveLength(0);
    expect(
      [...body().querySelectorAll('button:not([role="switch"])')].map(text),
    ).toEqual(['Gata']);
  });
});

// @traces 1391-FR-004 1391-FR-005
describe('the arrows of each row', () => {
  it('names each arrow with its row and the switch by its label', async () => {
    await open();

    expect(arrow('growth', 'up').getAttribute('aria-label')).toBe(
      'Mută mai sus: Creștere',
    );
    expect(arrow('growth', 'down').getAttribute('aria-label')).toBe(
      'Mută mai jos: Creștere',
    );
    expect(
      rowOf('growth')
        .querySelector('[role="switch"]')
        ?.getAttribute('aria-label'),
    ).toBe('Ascunde: Creștere');
  });

  it('names the arrows in English', async () => {
    await open({}, 'en');

    expect(arrow('log', 'up').getAttribute('aria-label')).toBe(
      'Move up: Jurnal',
    );
  });

  it('disables the first row up and the last row down only', async () => {
    await open();

    expect(arrow('numbers', 'up').disabled).toBe(true);
    expect(arrow('numbers', 'down').disabled).toBe(false);
    expect(arrow('growth', 'up').disabled).toBe(false);
    expect(arrow('growth', 'down').disabled).toBe(false);
    expect(arrow('log', 'up').disabled).toBe(false);
    expect(arrow('log', 'down').disabled).toBe(true);
  });

  it('reports the move and follows the new order and positions', async () => {
    const { move } = await open();

    arrow('log', 'up').click();
    await settle();

    expect(move).toHaveBeenCalledWith('log', 'up');
    expect(keys()).toEqual(['numbers', 'log', 'growth']);
    expect(text(rowOf('log').querySelector('.position'))).toBe('2');
  });

  it('keeps focus on the pressed arrow of the moved row', async () => {
    await open();

    arrow('numbers', 'down').focus();
    arrow('numbers', 'down').click();
    await settle();

    expect(document.activeElement).toBe(arrow('numbers', 'down'));
  });

  it('moves focus to the other arrow when the pressed one is now disabled', async () => {
    await open();

    arrow('growth', 'down').focus();
    arrow('growth', 'down').click();
    await settle();

    expect(keys()).toEqual(['numbers', 'log', 'growth']);
    expect(document.activeElement).toBe(arrow('growth', 'up'));
  });

  it('keeps the arrows pressable while a move is being saved', async () => {
    const { move } = await open({ move: () => new Promise(() => undefined) });

    arrow('log', 'up').click();
    await settle();
    arrow('log', 'up').click();
    await settle();

    expect(move).toHaveBeenCalledTimes(2);
    expect(keys()).toEqual(['log', 'numbers', 'growth']);
  });

  it('shows the failure once and keeps focus on the pressed arrow', async () => {
    await open({ move: async () => false });

    arrow('growth', 'up').focus();
    arrow('growth', 'up').click();
    await settle();

    expect(text(alert())).toBe('Nu am putut salva. Încearcă din nou.');
    expect(body().querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(document.activeElement).toBe(arrow('growth', 'up'));
  });
});

// @traces 1391-FR-006 1391-FR-009
describe('going back to the default', () => {
  it('offers the reset before "Gata" and reports it', async () => {
    const { reset } = await open();

    const actions = [...body().querySelectorAll('.actions button')].map(text);
    expect(actions).toEqual(['Revino la varianta implicită', 'Gata']);

    button('Revino la varianta implicită').click();
    await settle();
    expect(reset).toHaveBeenCalledTimes(1);
    expect(alert()).toBeNull();
  });

  it('shows the failure when the reset fails', async () => {
    await open({ reset: async () => false });

    button('Revino la varianta implicită').click();
    await settle();

    expect(text(alert())).toBe('Nu am putut salva. Încearcă din nou.');
  });

  it('keeps nothing in the browser', async () => {
    await open();
    const stored = jest.spyOn(Storage.prototype, 'setItem');

    arrow('log', 'up').click();
    button('Revino la varianta implicită').click();
    await settle();

    expect(stored).not.toHaveBeenCalled();
  });
});
