import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  type GarageMemberDto,
  type GarageMemberInviteDto,
  type GarageMembersDto,
  GaragesService,
  type MeDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { filter, Subject } from 'rxjs';

import { GarageMembers } from './garage-members';
import { Live } from '../live';
import { Session } from '../session';

const GARAGE = '0f9c2a54-6a1e-4f43-9d2b-2f5a3c1d7e10';
// Noon UTC on yesterday's calendar day in Bucharest: yesterday there even on
// the night the clocks change, when 24 hours ago can still be today.
const [YEAR, MONTH, DATE] = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Bucharest',
})
  .format(new Date())
  .split('-')
  .map(Number);
const YESTERDAY = new Date(Date.UTC(YEAR, MONTH - 1, DATE - 1, 12));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const member = (over: Partial<GarageMemberDto> = {}): GarageMemberDto => ({
  accountId: 'account-1',
  name: 'Mihai Ionescu',
  permissions: null,
  role: 'owner',
  since: '2026-09-01T08:00:00.000Z',
  ...over,
});
const invite = (
  over: Partial<GarageMemberInviteDto> = {},
): GarageMemberInviteDto => ({
  email: 'andrei@example.test',
  id: 'invite-1',
  kind: 'mechanic',
  sentAt: new Date().toISOString(),
  ...over,
});

const SEEDED: GarageMembersDto = {
  invites: [
    invite(),
    invite({
      email: 'elena@example.test',
      id: 'invite-2',
      kind: 'receptionist',
      sentAt: YESTERDAY.toISOString(),
    }),
    invite({
      email: 'dan@example.test',
      id: 'invite-3',
      sentAt: '2026-10-14T10:00:00.000Z',
    }),
  ],
  members: [
    member(),
    member({
      accountId: 'account-2',
      name: 'Ioana Marin',
      role: 'receptionist',
      since: '2026-09-02T09:30:00.000Z',
    }),
    member({
      accountId: 'account-3',
      name: 'Vlad Stan',
      permissions: {
        canAnswerQuotes: false,
        canMoveBookings: false,
        canRecordFinalPrice: false,
      },
      role: 'mechanic',
      since: null,
    }),
    member({
      accountId: 'account-4',
      name: 'Sorin Ilie',
      permissions: {
        canAnswerQuotes: true,
        canMoveBookings: true,
        canRecordFinalPrice: true,
      },
      role: 'mechanic',
      since: null,
    }),
  ],
};

const me = { garageId: GARAGE } as unknown as MeDto;

let events: Subject<LiveMessage>;
let list: jest.Mock;

async function render(
  answer: () => Promise<GarageMembersDto> = async () => SEEDED,
  language: 'ro' | 'en' = 'ro',
) {
  events = new Subject();
  list = jest.fn(answer);
  TestBed.configureTestingModule({
    providers: [
      {
        provide: GaragesService,
        useValue: { garageMembersControllerList: list },
      },
      {
        provide: Session,
        useValue: { current: signal(me), shown: signal(me) },
      },
      {
        provide: Live,
        useValue: {
          events,
          on: (kinds: readonly EventKind[]) =>
            events.pipe(
              filter((m) => (kinds as readonly string[]).includes(m.kind)),
            ),
          resync: new Subject<void>(),
        },
      },
    ],
  });
  await TestBed.inject(I18n).enter('garage');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(GarageMembers);
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
  };
  return { element, settle };
}

const text = (element: Element | null) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const memberRows = (element: HTMLElement) =>
  [...element.querySelectorAll('[data-member]')].map(text);
const inviteRows = (element: HTMLElement) =>
  [...element.querySelectorAll('[data-invite]')].map(text);
const message = (kind: string) =>
  ({ at: '2026-10-24T09:00:00.000Z', id: GARAGE, kind }) as LiveMessage;

afterEach(() => TestBed.resetTestingModule());

// @traces 102-FR-013
// @traces 102-FR-017
describe('Persoane cu acces, the rows', () => {
  it("reads the session garage and shows a row per member in the API's order under its title", async () => {
    const { element, settle } = await render();
    await settle();

    expect(list).toHaveBeenCalledWith({ garageId: GARAGE });
    expect(text(element.querySelector('h2'))).toBe('Persoane cu acces');
    expect(memberRows(element)).toEqual([
      'Mihai Ionescu · proprietar · din 1 sept. 2026',
      'Ioana Marin · recepție · din 2 sept. 2026',
      'Vlad Stan · mecanic',
      'Sorin Ilie · mecanic · poate muta programări, poate răspunde la cereri, poate înregistra prețul final',
    ]);
  });

  it('lists the pending invites as e-mail, role and when it was sent: today, yesterday, else the day', async () => {
    const { element, settle } = await render();
    await settle();

    expect(text(element.querySelector('h3'))).toBe('Invitații în așteptare');
    expect(inviteRows(element)).toEqual([
      'andrei@example.test · mecanic · trimisă azi',
      'elena@example.test · recepție · trimisă ieri',
      'dan@example.test · mecanic · trimisă 14 oct. 2026',
    ]);
  });

  it('says so when no invite is pending', async () => {
    const { element, settle } = await render(async () => ({
      ...SEEDED,
      invites: [],
    }));
    await settle();

    expect(inviteRows(element)).toEqual([]);
    expect(text(element.querySelector('[data-no-invites]'))).toBe(
      'Nicio invitație în așteptare.',
    );
  });

  it('says it all in English', async () => {
    const { element, settle } = await render(undefined, 'en');
    await settle();

    expect(text(element.querySelector('h2'))).toBe('People with access');
    expect(memberRows(element)).toEqual([
      'Mihai Ionescu · owner · since 1 Sep 2026',
      'Ioana Marin · front desk · since 2 Sep 2026',
      'Vlad Stan · mechanic',
      'Sorin Ilie · mechanic · can move bookings, can answer requests, can record the final price',
    ]);
    expect(text(element.querySelector('h3'))).toBe('Pending invites');
    expect(inviteRows(element)).toEqual([
      'andrei@example.test · mechanic · sent today',
      'elena@example.test · front desk · sent yesterday',
      'dan@example.test · mechanic · sent 14 Oct 2026',
    ]);
  });

  it('shows a name and an e-mail typed with markup as text', async () => {
    const { element, settle } = await render(async () => ({
      invites: [invite({ email: '<i>x</i>@example.test' })],
      members: [member({ name: '<b>Ion</b>' })],
    }));
    await settle();

    expect(element.querySelector('b, i')).toBeNull();
    expect(memberRows(element)[0]).toContain('<b>Ion</b>');
    expect(inviteRows(element)[0]).toContain('<i>x</i>@example.test');
  });

  it('keeps the Romanian and English blocks key-equal', () => {
    const keys = (value: unknown, prefix = ''): string[] =>
      value && typeof value === 'object'
        ? Object.entries(value).flatMap(([k, v]) => keys(v, `${prefix}.${k}`))
        : [prefix];
    const block = (language: string) =>
      JSON.parse(
        readFileSync(
          join(
            __dirname,
            `../../../../../../libs/i18n/src/garage/${language}.json`,
          ),
          'utf8',
        ),
      ).members;

    expect(keys(block('ro')).sort()).toEqual(keys(block('en')).sort());
    expect(JSON.stringify(block('ro'))).not.toMatch(/[şţŞŢ]/);
  });
});

// @traces 102-FR-014
// @traces 102-FR-018
describe('Persoane cu acces, loading, failing and reading again', () => {
  it('shows three skeleton rows, busy and hidden from assistive technology, while the first read is in flight', async () => {
    const { element, settle } = await render(
      () => new Promise(() => undefined),
    );
    await settle();

    const busy = element.querySelector('[aria-busy="true"]');
    expect(busy?.querySelectorAll('[data-skeleton]')).toHaveLength(3);
    expect(element.querySelector('[role="status"]')).not.toBeNull();
    expect(memberRows(element)).toEqual([]);
  });

  it.each([
    ['a server error', new HttpErrorResponse({ status: 500 })],
    ['a refusal', new HttpErrorResponse({ status: 403 })],
    ['a network error', new HttpErrorResponse({ status: 0 })],
  ])(
    'says it could not load on %s, and Reîncearcă reads again',
    async (_, failure) => {
      let calls = 0;
      const { element, settle } = await render(async () => {
        calls += 1;
        if (calls === 1) throw failure;
        return SEEDED;
      });
      await settle();

      expect(text(element.querySelector('[role="alert"]'))).toBe(
        'Nu am putut încărca persoanele cu acces.',
      );
      const retry = element.querySelector<HTMLButtonElement>('button');
      expect(text(retry)).toBe('Reîncearcă');
      retry?.click();
      await settle();
      await wait(0);
      await settle();

      expect(list).toHaveBeenCalledTimes(2);
      expect(element.querySelector('[role="alert"]')).toBeNull();
      expect(memberRows(element)).toHaveLength(4);
    },
  );

  it.each([
    'invite.sent',
    'invite.revoked',
    'invite.accepted',
    'mechanic.updated',
    'mechanic.removed',
    'member.removed',
  ])('reads again when the stream says %s', async (kind) => {
    const { settle } = await render();
    await settle();
    expect(list).toHaveBeenCalledTimes(1);

    events.next(message(kind));
    await wait(350);
    await settle();

    expect(list).toHaveBeenCalledTimes(2);
  });

  it('does not read again on another kind', async () => {
    const { settle } = await render();
    await settle();

    events.next(message('rating.updated'));
    events.next(message('booking.moved'));
    await wait(350);
    await settle();

    expect(list).toHaveBeenCalledTimes(1);
  });

  it('gives the rows list semantics', async () => {
    const { element, settle } = await render();
    await settle();

    const lists = [...element.querySelectorAll('ul')];
    expect(lists).toHaveLength(2);
    for (const ul of lists)
      for (const child of ul.children) expect(child.tagName).toBe('LI');
  });

  it('lets each row wrap on a phone and sit on one line from a tablet', () => {
    const css = readFileSync(join(__dirname, 'garage-members.css'), 'utf8');

    expect(css).toMatch(/\.row \{[^}]*flex-wrap: wrap;/);
    expect(css).toMatch(/\.row > \* \{[^}]*overflow-wrap: anywhere;/);
    expect(css).toMatch(/@media \(min-width: 768px\)/);
  });
});
