import { HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  AdminService,
  type AdminStatusDto,
  type StatusTileDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { filter, Subject } from 'rxjs';

import { AdminStatus } from './admin-status';
import { Live } from '../live';

const tile = (
  key: StatusTileDto['key'],
  state: StatusTileDto['state'],
  ro: string,
  en: string,
  extra: Partial<StatusTileDto> = {},
): StatusTileDto =>
  ({
    checkedAt: '2026-11-03T08:40:00.000Z',
    detail: {},
    key,
    short: { en, ro },
    since: '2026-11-03T08:40:00.000Z',
    stale: false,
    state,
    ...extra,
  }) as StatusTileDto;

// The brief's scenario 1: Maps slow, Backup failed, the rest green.
const troubled = (): AdminStatusDto => ({
  problems: ['backup', 'maps'],
  sentences: {
    en: [
      'Last night’s backup failed at 03:00. The data is safe, but there is no fresh copy.',
      'Maps have answered slowly since 10:40. Search by distance may lag.',
    ],
    ro: [
      'Backup‑ul de azi‑noapte a eșuat la 03:00. Datele sunt în siguranță, dar nu există o copie proaspătă.',
      'Hărțile răspund lent din 10:40. Căutarea după distanță poate întârzia.',
    ],
  },
  tiles: [
    tile('api', 'green', 'p95 180 ms', 'p95 180 ms'),
    tile('search', 'green', 'p95 240 ms', 'p95 240 ms'),
    tile('maps', 'amber', 'lent · 1,9 s', 'slow · 1.9 s'),
    tile('email', 'green', 'livrare 99%', 'delivery 99%'),
    tile('notifications', 'green', 'normal', 'normal'),
    tile('backup', 'red', 'eșuat 03:00', 'failed 03:00'),
  ],
});

// The brief's scenario 2: all green.
const calm = (): AdminStatusDto => ({
  problems: [],
  sentences: {
    en: ['All services work normally.'],
    ro: ['Toate serviciile funcționează normal.'],
  },
  tiles: [
    tile('api', 'green', 'p95 180 ms', 'p95 180 ms'),
    tile('search', 'green', 'p95 240 ms', 'p95 240 ms'),
    tile('maps', 'green', 'p95 300 ms', 'p95 300 ms'),
    tile('email', 'green', 'livrare 99%', 'delivery 99%'),
    tile('notifications', 'green', 'normal', 'normal'),
    tile('backup', 'green', 'ok 03:00', 'ok 03:00'),
  ],
});

let events: Subject<LiveMessage>;
let resync: Subject<void>;
let reads: number;
let answer: () => Promise<AdminStatusDto>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(
  language: 'ro' | 'en' = 'ro',
  platform: 'browser' | 'server' = 'browser',
) {
  events = new Subject();
  resync = new Subject();
  reads = 0;
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: platform },
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
          statusControllerRead: () => {
            reads++;
            return answer();
          },
        },
      },
    ],
  });
  const i18n = TestBed.inject(I18n);
  if (language === 'en') await i18n.use('en');
  await i18n.enter('admin');
  const fixture = TestBed.createComponent(AdminStatus);
  document.body.append(fixture.nativeElement);
  await settle();
  return fixture.nativeElement as HTMLElement;
}

const tiles = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLElement>('ul.tiles > li'),
];
const text = (node: Element | null) =>
  node?.textContent?.replace(/\s+/g, ' ').trim();
const read = (item: HTMLElement) => ({
  name: text(item.querySelector('.name')),
  short: text(item.querySelector('.short')),
  state: item.dataset['state'],
  word: text(item.querySelector('.word')),
});
const sentences = (element: HTMLElement) =>
  [...element.querySelectorAll('.sentence')].map(text);
const skeletons = (element: HTMLElement) =>
  element.querySelectorAll('.skeleton').length;
const changed = (kind = 'status_tile.changed'): LiveMessage =>
  ({
    at: new Date().toISOString(),
    id: 'maps',
    kind,
  }) as unknown as LiveMessage;
const burst = () => new Promise((resolve) => setTimeout(resolve, 350));
const refuse = (status: number) => async () => {
  throw new HttpErrorResponse({ status });
};

afterEach(() => {
  TestBed.resetTestingModule();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('AdminStatus', () => {
  // @traces 1425-FR-002 1425-FR-007
  it('is a region named by its heading Starea sistemului', async () => {
    answer = async () => calm();
    const element = await open();

    const section = element.querySelector('section') as HTMLElement;
    const heading = element.querySelector('h2') as HTMLElement;
    expect(text(heading)).toBe('Starea sistemului');
    expect(heading.id).not.toBe('');
    expect(section.getAttribute('aria-labelledby')).toBe(heading.id);
  });

  // @traces 1425-FR-002
  it('names the region System status in English', async () => {
    answer = async () => calm();
    const element = await open('en');

    expect(text(element.querySelector('h2'))).toBe('System status');
  });

  // @traces 1425-FR-004
  it('shows the six tiles in the order answered, each with its name, lamp word and short state', async () => {
    answer = async () => troubled();
    const element = await open();

    expect(tiles(element).map(read)).toEqual([
      { name: 'API', short: 'p95 180 ms', state: 'green', word: 'normal' },
      { name: 'Căutare', short: 'p95 240 ms', state: 'green', word: 'normal' },
      {
        name: 'Hărți',
        short: 'lent · 1,9 s',
        state: 'amber',
        word: 'degradat',
      },
      { name: 'E‑mail', short: 'livrare 99%', state: 'green', word: 'normal' },
      { name: 'Notificări', short: 'normal', state: 'green', word: 'normal' },
      { name: 'Backup', short: 'eșuat 03:00', state: 'red', word: 'căzut' },
    ]);
  });

  // @traces 1425-FR-004 1425-FR-005
  it('shows the tiles and sentences in English from the same answer', async () => {
    answer = async () => troubled();
    const element = await open('en');

    expect(tiles(element).map(read)).toEqual([
      { name: 'API', short: 'p95 180 ms', state: 'green', word: 'normal' },
      { name: 'Search', short: 'p95 240 ms', state: 'green', word: 'normal' },
      { name: 'Maps', short: 'slow · 1.9 s', state: 'amber', word: 'degraded' },
      { name: 'E‑mail', short: 'delivery 99%', state: 'green', word: 'normal' },
      {
        name: 'Notifications',
        short: 'normal',
        state: 'green',
        word: 'normal',
      },
      { name: 'Backup', short: 'failed 03:00', state: 'red', word: 'down' },
    ]);
    expect(sentences(element)).toEqual(troubled().sentences.en);
  });

  // @traces 1425-FR-004
  it('shows a stale tile as answered: red with its stale short state', async () => {
    const answered = calm();
    answered.tiles[1] = tile(
      'search',
      'red',
      'fără date din 10:40',
      'no data since 10:40',
      {
        stale: true,
      },
    );
    answer = async () => answered;
    const element = await open();

    expect(read(tiles(element)[1])).toEqual({
      name: 'Căutare',
      short: 'fără date din 10:40',
      state: 'red',
      word: 'căzut',
    });
  });

  // @traces 1425-FR-004 1425-FR-007
  it('hides the lamp from a screen reader and keeps the tiles out of the tab order', async () => {
    answer = async () => troubled();
    const element = await open();

    for (const item of tiles(element)) {
      expect(item.querySelector('.lamp')?.getAttribute('aria-hidden')).toBe(
        'true',
      );
      expect(item.querySelector('[tabindex], a, button')).toBeNull();
    }
  });

  // @traces 1425-FR-005
  it('shows the sentences under the tiles in the order answered, red first', async () => {
    answer = async () => troubled();
    const element = await open();

    expect(sentences(element)).toEqual(troubled().sentences.ro);
  });

  // @traces 1425-FR-005
  it('shows the one all-clear sentence when every tile is green', async () => {
    answer = async () => calm();
    const element = await open();

    expect(sentences(element)).toEqual([
      'Toate serviciile funcționează normal.',
    ]);
  });

  // @traces 1425-FR-007
  it('puts the sentences in a polite live region', async () => {
    answer = async () => calm();
    const element = await open();

    const region = element.querySelector('.sentence')?.parentElement;
    expect(region?.getAttribute('aria-live')).toBe('polite');
  });

  // @traces 1425-FR-006
  it('shows six wordless skeleton tiles and marks the region busy while the first read is out', async () => {
    answer = () => new Promise(() => undefined);
    const element = await open();

    expect(skeletons(element)).toBe(6);
    expect(tiles(element)).toHaveLength(0);
    expect(text(element.querySelector('.skeleton'))).toBe('');
    expect(element.querySelector('section')?.getAttribute('aria-busy')).toBe(
      'true',
    );
  });

  // @traces 1425-FR-003 1425-FR-006
  it('shows the skeletons on the server and reads nothing there', async () => {
    answer = async () => calm();
    const element = await open('ro', 'server');

    expect(skeletons(element)).toBe(6);
    expect(reads).toBe(0);
  });

  // @traces 1425-FR-006
  it('announces a failed first read and reads again on Reîncearcă', async () => {
    answer = refuse(500);
    const element = await open();

    expect(text(element.querySelector('[role="alert"]'))).toBe(
      'Nu am putut citi starea sistemului.',
    );
    expect(tiles(element)).toHaveLength(0);
    const retry = element.querySelector('button') as HTMLButtonElement;
    expect(text(retry)).toBe('Reîncearcă');
    expect(retry.type).toBe('button');
    expect(element.querySelector('section')?.getAttribute('aria-busy')).toBe(
      'false',
    );

    let arrive: (status: AdminStatusDto) => void = () => undefined;
    answer = () => new Promise((resolve) => (arrive = resolve));
    retry.click();
    await settle();

    expect(skeletons(element)).toBe(6);
    expect(element.querySelector('button')).toBeNull();

    arrive(calm());
    await settle();

    expect(element.querySelector('[role="alert"]')).toBeNull();
    expect(tiles(element)).toHaveLength(6);
    expect(reads).toBe(2);
  });

  // @traces 1425-FR-006
  it('names the failure and Retry in English', async () => {
    answer = refuse(500);
    const element = await open('en');

    expect(text(element.querySelector('[role="alert"]'))).toBe(
      'We could not read the system status.',
    );
    expect(text(element.querySelector('button'))).toBe('Retry');
  });

  // @traces 1425-FR-003 1425-FR-006
  it.each([403, 404])(
    'shows a %i as the error, not as a gone panel',
    async (status) => {
      answer = refuse(status);
      const element = await open();

      expect(text(element.querySelector('[role="alert"]'))).toBe(
        'Nu am putut citi starea sistemului.',
      );
      expect(element.querySelector('button')).not.toBeNull();
    },
  );

  // @traces 1425-FR-006
  it('reads a failed first read again by itself after 60 seconds', async () => {
    vi.useFakeTimers({ toNotFake: ['setImmediate'] });
    answer = refuse(503);
    const opening = open();
    await vi.advanceTimersByTimeAsync(50);
    const element = await opening;
    expect(reads).toBe(1);

    answer = async () => calm();
    await vi.advanceTimersByTimeAsync(59_000);
    expect(reads).toBe(1);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(reads).toBe(2);
    await vi.advanceTimersByTimeAsync(50);
    TestBed.tick();
    expect(tiles(element)).toHaveLength(6);
  });

  // @traces 1425-FR-003 1425-FR-009
  it('reads again on a status_tile.changed event, keeping the tiles shown meanwhile', async () => {
    answer = async () => calm();
    const element = await open();

    let arrive: (status: AdminStatusDto) => void = () => undefined;
    answer = () => new Promise((resolve) => (arrive = resolve));
    events.next(changed());
    await burst();
    await settle();

    expect(reads).toBe(2);
    expect(tiles(element)).toHaveLength(6);
    expect(skeletons(element)).toBe(0);
    expect(read(tiles(element)[2]).word).toBe('normal');

    arrive(troubled());
    await settle();

    expect(read(tiles(element)[2])).toEqual({
      name: 'Hărți',
      short: 'lent · 1,9 s',
      state: 'amber',
      word: 'degradat',
    });
    expect(sentences(element)).toEqual(troubled().sentences.ro);
  });

  // @traces 1425-FR-003
  it('reads once for a burst of events within 300 ms', async () => {
    answer = async () => calm();
    await open();

    events.next(changed());
    events.next(changed());
    events.next(changed());
    await burst();
    await settle();

    expect(reads).toBe(2);
  });

  // @traces 1425-FR-003
  it('ignores live events of other kinds', async () => {
    answer = async () => calm();
    await open();

    events.next(changed('system_log.added'));
    await burst();
    await settle();

    expect(reads).toBe(1);
  });

  // @traces 1425-FR-003
  it('reads again on a resync', async () => {
    answer = async () => calm();
    await open();

    resync.next();
    await settle();

    expect(reads).toBe(2);
  });

  // @traces 1425-FR-003
  it('keeps the tiles and shows no error when a re-read fails', async () => {
    answer = async () => troubled();
    const element = await open();

    answer = refuse(500);
    resync.next();
    await settle();

    expect(reads).toBe(2);
    expect(
      tiles(element)
        .map(read)
        .map((t) => t.state),
    ).toEqual(['green', 'green', 'amber', 'green', 'green', 'red']);
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });
});
