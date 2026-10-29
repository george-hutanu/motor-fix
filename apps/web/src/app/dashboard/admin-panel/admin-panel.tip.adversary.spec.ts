import { HttpErrorResponse } from '@angular/common/http';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import { AdminService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { filter, Subject } from 'rxjs';

import { AdminPanel } from './admin-panel';
import { AdminOverview } from '../admin-overview';
import { Live } from '../live';

@Component({ imports: [AdminPanel], template: '<mf-admin-panel />' })
class Host {}

const OK = {
  activeDrivers: 12480,
  activeDriversMonthStart: 12168,
  answerRate: 66,
  bookings: 17,
  garagesApprovedThisMonth: 9,
  garagesListed: 214,
  garagesWaiting: 2,
  requestsSent: 1250,
};
const REASON = 'Cifrele nu au putut fi citite';

let answer: () => Promise<unknown>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(language: 'ro' | 'en' = 'ro') {
  const events = new Subject<LiveMessage>();
  const resync = new Subject<void>();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      AdminOverview,
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
      {
        provide: AdminService,
        useValue: {
          adminOverviewControllerGrowth: async () => ({ months: [] }),
          adminOverviewControllerOverview: () => answer(),
          adminOverviewControllerQueue: async () => ({ items: [], total: 0 }),
          demandControllerDemand: async () => ({
            brands: [],
            firstDay: '2026-09-18',
            jobs: [],
            lastDay: '2026-10-17',
            requests: 0,
          }),
          systemLogControllerList: async () => ({ items: [] }),
        },
      },
    ],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(Host);
  await settle();
  return { element: fixture.nativeElement as HTMLElement, resync };
}

const fail = async () => {
  throw new HttpErrorResponse({ status: 503 });
};
const groups = (el: HTMLElement) => [
  ...el.querySelectorAll<HTMLElement>('mf-admin-panel [role="group"]'),
];
const buttons = (el: HTMLElement) => [
  ...el.querySelectorAll<HTMLButtonElement>(
    'mf-admin-panel [role="group"] button',
  ),
];
const tips = (el: HTMLElement) => [
  ...el.querySelectorAll<HTMLElement>('mf-admin-panel [role="tooltip"]'),
];
const shown = (el: HTMLElement) => tips(el).filter((t) => !t.hidden);

afterEach(() => TestBed.resetTestingModule());

// @traces 1263-admin-dashboard-customise-FR-010
describe('the failed tile tip under odd use', () => {
  beforeEach(() => {
    answer = fail;
  });

  it('shows no tip and no button when the figures are read', async () => {
    answer = async () => OK;
    const { element } = await open();
    expect(buttons(element)).toEqual([]);
    expect(shown(element)).toEqual([]);
  });

  it('ends on an open tip after three quick presses', async () => {
    const { element } = await open();
    const [button] = buttons(element);
    button.click();
    button.click();
    button.click();
    await settle();
    expect(shown(element)).toHaveLength(1);
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  it('ends on a closed tip after four quick presses', async () => {
    const { element } = await open();
    const [button] = buttons(element);
    for (let i = 0; i < 4; i++) button.click();
    await settle();
    expect(shown(element)).toEqual([]);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('does not open on Enter or Space keydown alone, only on the click a browser sends', async () => {
    const { element } = await open();
    const [button] = buttons(element);
    for (const key of ['Enter', ' '])
      button.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, key }),
      );
    await settle();
    expect(shown(element)).toEqual([]);
  });

  it('keeps the tip closed on Escape when it is already closed', async () => {
    const { element } = await open();
    const [button] = buttons(element);
    button.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await settle();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(shown(element)).toEqual([]);
  });

  it('opens again on a press after Escape closed it', async () => {
    const { element } = await open();
    const [button] = buttons(element);
    button.click();
    await settle();
    button.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await settle();
    button.click();
    await settle();
    expect(shown(element)).toHaveLength(1);
  });

  it('opens again on a press after focus left', async () => {
    const { element } = await open();
    const [button] = buttons(element);
    button.click();
    await settle();
    button.dispatchEvent(new FocusEvent('blur'));
    await settle();
    button.click();
    await settle();
    expect(shown(element)).toHaveLength(1);
  });

  it('shows the same reason text in every tip, in the tile name, only for the open tile', async () => {
    const { element } = await open();
    const all = buttons(element);
    all[2].click();
    await settle();
    const named = groups(element).filter((g) =>
      g.getAttribute('aria-label')?.includes(REASON),
    );
    expect(named).toHaveLength(1);
    expect(named[0]).toBe(all[2].closest('[role="group"]'));
    expect(shown(element)[0].textContent?.trim()).toBe(REASON);
  });

  it('links the button to the one tip that shows and no other', async () => {
    const { element } = await open();
    const all = buttons(element);
    all[1].click();
    await settle();
    const described = all
      .map((b) => b.getAttribute('aria-describedby'))
      .filter((id) => id !== null);
    expect(described).toEqual([shown(element)[0].id]);
  });

  it('closes the tip and removes every button when a re-read succeeds', async () => {
    const { element, resync } = await open();
    buttons(element)[0].click();
    await settle();
    answer = async () => OK;
    resync.next();
    await settle();
    expect(buttons(element)).toEqual([]);
    expect(shown(element)).toEqual([]);
    expect(
      groups(element).some((g) =>
        g.getAttribute('aria-label')?.includes(REASON),
      ),
    ).toBe(false);
  });

  it('reads every tip in English after the language changes while one is open', async () => {
    const { element } = await open();
    buttons(element)[0].click();
    await settle();
    await TestBed.inject(I18n).use('en');
    await settle();
    for (const button of buttons(element))
      expect(button.getAttribute('aria-label')).toBe('Why?');
    for (const tip of tips(element))
      expect(tip.textContent).not.toContain('Cifrele');
  });

  it('keeps the button label free of the reason in English', async () => {
    const { element } = await open('en');
    for (const button of buttons(element))
      expect(button.getAttribute('aria-label')).toBe('Why?');
    expect(buttons(element).length).toBeGreaterThan(1);
  });

  it('gives the tip a unique id per tile so two tiles never share one', async () => {
    const { element } = await open();
    const ids = tips(element).map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[A-Za-z][\w-]*$/.test(id))).toBe(true);
  });
});
