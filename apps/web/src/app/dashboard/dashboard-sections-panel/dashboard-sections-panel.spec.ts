import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import {
  DashboardSectionsPanel,
  type PanelRow,
  type SectionsPanelData,
} from './dashboard-sections-panel';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const ROWS: PanelRow[] = [
  {
    description: 'Cereri noi, programări',
    key: 'kpi',
    name: 'Cifrele zilei',
    position: 1,
    shown: true,
  },
  {
    description: 'Util doar dacă lucrezi pe elevatoare',
    key: 'sched',
    name: 'Programul pe elevatoare',
    position: 2,
    shown: false,
  },
  {
    description: 'Ultimele recenzii',
    key: 'reviews',
    name: 'Recenzii noi',
    position: 3,
    shown: true,
  },
];

let result: Promise<OverlayResult<'done'>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(
  toggle: SectionsPanelData['toggle'] = async () => true,
  language: 'ro' | 'en' = 'ro',
) {
  const rows = signal<readonly PanelRow[]>(ROWS);
  await TestBed.inject(I18n).enter('garage');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  const spy = jest.fn(toggle);
  result = host.componentInstance.overlays.open<'done', SectionsPanelData>(
    DashboardSectionsPanel,
    {
      confirmDiscard: false,
      data: { messages: 'garage.home.panel', rows, toggle: spy },
      shape: 'drawer',
      title: 'garage.home.panel.title',
    },
  );
  await settle();
  return { rows, toggle: spy };
}

const body = () =>
  document.querySelector('mf-dashboard-sections-panel') as HTMLElement;
const text = (el: Element | null) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
// Each piece of text in a row, in reading order.
const words = (el: Element) => {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const part = (node.textContent ?? '').trim();
    if (part) parts.push(part);
  }
  return parts.join(' ');
};
const rowsOf = () => [...body().querySelectorAll<HTMLElement>('[data-row]')];
const switches = () => [
  ...body().querySelectorAll<HTMLButtonElement>('button[role="switch"]'),
];
const named = (name: string) =>
  switches().find(
    (control) => control.getAttribute('aria-label') === name,
  ) as HTMLButtonElement;
const alert = () => body().querySelector('[role="alert"]');
const done = () =>
  [...body().querySelectorAll('button')].find(
    (b) => b.getAttribute('role') !== 'switch',
  ) as HTMLButtonElement;

afterEach(() => {
  document.body.innerHTML = '';
});

// @traces 011-FR-004
// @traces 011-FR-010
// @traces 011-FR-011
describe('the sections panel rows', () => {
  it('says what it does, then lists each row with its position, name and description', async () => {
    await open();

    expect(text(body())).toContain(
      'Oprește secțiunile de care nu ai nevoie. Se salvează în contul tău.',
    );
    expect(rowsOf().map(words)).toEqual([
      '1 Cifrele zilei Cereri noi, programări',
      '2 Programul pe elevatoare Util doar dacă lucrezi pe elevatoare',
      '3 Recenzii noi Ultimele recenzii',
    ]);
  });

  it('names each switch by its section and checks it while shown', async () => {
    await open();

    expect(switches().map((s) => s.getAttribute('aria-label'))).toEqual([
      'Cifrele zilei',
      'Programul pe elevatoare',
      'Recenzii noi',
    ]);
    expect(switches().map((s) => s.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'true',
    ]);
  });

  it('marks only the rows switched off', async () => {
    await open();

    expect(rowsOf().map((row) => row.hasAttribute('data-off'))).toEqual([
      false,
      true,
      false,
    ]);
  });

  it('follows the rows when they change while open', async () => {
    const { rows } = await open();

    rows.set([{ ...ROWS[0], shown: false }, ROWS[2]]);
    await settle();

    expect(rowsOf()).toHaveLength(2);
    expect(named('Cifrele zilei').getAttribute('aria-checked')).toBe('false');
    expect(rowsOf()[0].hasAttribute('data-off')).toBe(true);
  });

  it('reads its line and button in English', async () => {
    await open(undefined, 'en');

    expect(text(body())).toContain(
      'Switch off the sections you don’t need. It is saved to your account.',
    );
    expect(text(done())).toBe('Done');
  });
});

// @traces 011-FR-007
// @traces 011-FR-013
describe('switching a row', () => {
  it('reports the key and the new state', async () => {
    const { toggle } = await open();

    named('Recenzii noi').click();
    await settle();

    expect(toggle).toHaveBeenCalledWith('reviews', false);
  });

  it('disables only that switch while its save is pending', async () => {
    let finish: (ok: boolean) => void = () => undefined;
    await open(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );

    named('Cifrele zilei').click();
    await settle();

    expect(named('Cifrele zilei').disabled).toBe(true);
    expect(named('Recenzii noi').disabled).toBe(false);

    finish(true);
    await settle();
    expect(named('Cifrele zilei').disabled).toBe(false);
  });

  it('shows the failure as an alert and flips the switch back', async () => {
    await open(async () => false);

    named('Recenzii noi').click();
    await settle();

    expect(text(alert())).toBe('Nu am putut salva. Încearcă din nou.');
    expect(named('Recenzii noi').getAttribute('aria-checked')).toBe('true');
  });

  it('keeps the alert until a switch saves', async () => {
    let ok = false;
    await open(async () => ok);

    named('Recenzii noi').click();
    await settle();
    named('Cifrele zilei').click();
    await settle();
    expect(alert()).not.toBeNull();

    ok = true;
    named('Cifrele zilei').click();
    await settle();
    expect(alert()).toBeNull();
  });

  it('closes with done on "Gata"', async () => {
    await open();

    expect(text(done())).toBe('Gata');
    done().click();

    expect(await result).toBe('done');
  });
});
