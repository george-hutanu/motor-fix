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

const row = (key: string, position: number, shown = true): PanelRow => ({
  description: `${key} description`,
  key,
  name: `${key} name`,
  position,
  shown,
});

let result: Promise<OverlayResult<'done'>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(
  initial: readonly PanelRow[],
  toggle: SectionsPanelData['toggle'] = async () => true,
) {
  const rows = signal<readonly PanelRow[]>(initial);
  await TestBed.inject(I18n).enter('garage');
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
const switches = () => [
  ...body().querySelectorAll<HTMLButtonElement>('button[role="switch"]'),
];
const named = (name: string) =>
  switches().find(
    (s) => s.getAttribute('aria-label') === name,
  ) as HTMLButtonElement;
const alert = () => body().querySelector('[role="alert"]');

afterEach(() => {
  document.body.innerHTML = '';
});

// @traces 011-FR-004
// @traces 011-FR-010
describe('the sections panel, hostile rows', () => {
  it('lists no switch and no alert for an empty list but still offers Gata', async () => {
    await open([]);

    expect(switches()).toHaveLength(0);
    expect(alert()).toBeNull();
    expect(
      [...body().querySelectorAll('button')].map((b) => b.textContent?.trim()),
    ).toEqual(['Gata']);
  });

  it('shows a name made of markup as text', async () => {
    await open([{ ...row('kpi', 1), name: '<img src=x onerror=alert(1)>' }]);

    expect(body().querySelector('img')).toBeNull();
    expect(switches()[0].getAttribute('aria-label')).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });

  it('shows the position the row carries, not its index', async () => {
    await open([row('kpi', 5), row('req', 9)]);

    const rows = [...body().querySelectorAll('[data-row]')];
    expect(
      rows.map((r) => r.textContent?.trim().startsWith(String(5))),
    ).toEqual([true, false]);
    expect(rows[1].textContent).toContain('9');
  });

  it('renders five hundred rows in order', async () => {
    const many = Array.from({ length: 500 }, (_, i) => row(`k${i}`, i + 1));
    await open(many);

    expect(switches()).toHaveLength(500);
    expect(switches()[499].getAttribute('aria-label')).toBe('k499 name');
  });
});

// @traces 011-FR-006
describe('switching a row, hostile cases', () => {
  it('sends one report when a pending switch is pressed twice', async () => {
    let finish: (ok: boolean) => void = () => undefined;
    const { toggle } = await open(
      [row('kpi', 1)],
      () => new Promise<boolean>((resolve) => (finish = resolve)),
    );

    named('kpi name').click();
    await settle();
    named('kpi name').click();
    await settle();

    expect(toggle).toHaveBeenCalledTimes(1);
    finish(true);
    await settle();
  });

  it('reports the opposite of the live row after the rows are re-read', async () => {
    const { rows, toggle } = await open([row('kpi', 1, true)]);

    rows.set([row('kpi', 1, false)]);
    await settle();
    named('kpi name').click();
    await settle();

    expect(toggle).toHaveBeenCalledWith('kpi', true);
  });

  it('treats a rejected save as a failed save and shows the alert', async () => {
    await open([row('kpi', 1)], () => Promise.reject(new Error('down')));

    named('kpi name').click();
    await settle();

    expect(alert()?.textContent).toContain('Nu am putut salva');
    expect(named('kpi name').disabled).toBe(false);
  });

  it('keeps the alert while another row fails and clears it on the next success', async () => {
    const outcomes = [false, false, true];
    await open([row('kpi', 1), row('req', 2)], async () => outcomes.shift()!);

    named('kpi name').click();
    await settle();
    named('req name').click();
    await settle();
    expect(alert()).not.toBeNull();

    named('kpi name').click();
    await settle();
    expect(alert()).toBeNull();
  });

  it('shows one alert, not one per failure', async () => {
    await open([row('kpi', 1)], async () => false);

    named('kpi name').click();
    await settle();
    named('kpi name').click();
    await settle();

    expect(body().querySelectorAll('[role="alert"]')).toHaveLength(1);
  });
});

// @traces 011-FR-007
describe('closing the panel', () => {
  it('closes on Escape with no discard question', async () => {
    await open([row('kpi', 1)]);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await settle();

    expect(document.querySelector('mf-dashboard-sections-panel')).toBeNull();
    expect(await result).toBeDefined();
  });
});
