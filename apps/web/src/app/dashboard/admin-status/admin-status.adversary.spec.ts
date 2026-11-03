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

const calm = (): AdminStatusDto => ({
  problems: [],
  sentences: {
    en: ['All services work normally.'],
    ro: ['Toate serviciile funcționează normal.'],
  },
  tiles: [
    tile('api', 'green', 'ro api', 'en api'),
    tile('search', 'green', 'ro search', 'en search'),
    tile('maps', 'green', 'ro maps', 'en maps'),
    tile('email', 'green', 'ro email', 'en email'),
    tile('notifications', 'green', 'ro notif', 'en notif'),
    tile('backup', 'green', 'ro backup', 'en backup'),
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

async function open(language: 'ro' | 'en' = 'ro') {
  events = new Subject();
  resync = new Subject();
  reads = 0;
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: 'browser' },
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
  return { element: fixture.nativeElement as HTMLElement, fixture, i18n };
}

const text = (node: Element | null) =>
  node?.textContent?.replace(/\s+/g, ' ').trim();
const tiles = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLElement>('ul.tiles > li'),
];
const sentences = (element: HTMLElement) =>
  [...element.querySelectorAll('.sentence')].map(text);
const changed = (): LiveMessage =>
  ({
    at: new Date().toISOString(),
    id: 'maps',
    kind: 'status_tile.changed',
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

describe('AdminStatus adversary', () => {
  // @traces 1425-FR-003
  it('makes exactly one further read after an event and a resync arrive while a read is out', async () => {
    answer = async () => calm();
    await open();

    const arrivals: Array<(s: AdminStatusDto) => void> = [];
    answer = () => new Promise((resolve) => arrivals.push(resolve));
    events.next(changed());
    await burst();
    await settle();
    expect(reads).toBe(2);

    events.next(changed());
    resync.next();
    resync.next();
    await burst();
    await settle();
    expect(reads).toBe(2);

    arrivals[0](calm());
    await settle();
    await burst();
    await settle();
    expect(reads).toBe(3);
  });

  // @traces 1425-FR-003
  it('never reads in parallel while the first read is out and events keep arriving', async () => {
    answer = () => new Promise(() => undefined);
    await open();

    for (let i = 0; i < 5; i++) {
      events.next(changed());
      resync.next();
    }
    await burst();
    await settle();

    expect(reads).toBe(1);
  });

  // @traces 1425-FR-003
  it('reads once per separated event, not once for two events 400 ms apart', async () => {
    answer = async () => calm();
    await open();

    events.next(changed());
    await burst();
    await settle();
    events.next(changed());
    await burst();
    await settle();

    expect(reads).toBe(3);
  });

  // @traces 1425-FR-003
  it('reads nothing more after the panel is destroyed', async () => {
    answer = async () => calm();
    const { fixture } = await open();

    fixture.destroy();
    events.next(changed());
    resync.next();
    await burst();
    await settle();

    expect(reads).toBe(1);
  });

  // @traces 1425-FR-003
  it('survives an answer that arrives after the panel is destroyed', async () => {
    let arrive: (s: AdminStatusDto) => void = () => undefined;
    answer = () => new Promise((resolve) => (arrive = resolve));
    const { fixture, element } = await open();

    fixture.destroy();
    arrive(calm());
    await settle();

    expect(tiles(element)).toHaveLength(0);
    expect(reads).toBe(1);
  });

  // @traces 1425-FR-003 1425-FR-006
  it('stays in the error state when Reîncearcă is answered 403 again', async () => {
    answer = refuse(403);
    const { element } = await open();

    (element.querySelector('button') as HTMLButtonElement).click();
    await settle();

    expect(reads).toBe(2);
    expect(text(element.querySelector('[role="alert"]'))).toBe(
      'Nu am putut citi starea sistemului.',
    );
    expect(element.querySelector('button')).not.toBeNull();
    expect(tiles(element)).toHaveLength(0);
  });

  // @traces 1425-FR-006
  it('does not read a 403 again by itself after 60 seconds', async () => {
    vi.useFakeTimers({ toNotFake: ['setImmediate'] });
    answer = refuse(403);
    const opening = open();
    await vi.advanceTimersByTimeAsync(50);
    await opening;

    await vi.advanceTimersByTimeAsync(130_000);

    expect(reads).toBe(1);
  });

  // @traces 1425-FR-006
  it('reads once when Reîncearcă is clicked twice in a row', async () => {
    answer = refuse(500);
    const { element } = await open();

    answer = () => new Promise(() => undefined);
    const retry = element.querySelector('button') as HTMLButtonElement;
    retry.click();
    retry.click();
    await settle();

    expect(reads).toBe(2);
  });

  // @traces 1425-FR-006
  it('never shows the error and tiles together after a retry that succeeds', async () => {
    answer = refuse(500);
    const { element } = await open();

    answer = async () => calm();
    (element.querySelector('button') as HTMLButtonElement).click();
    await settle();

    expect(tiles(element)).toHaveLength(6);
    expect(element.querySelector('[role="alert"]')).toBeNull();
    expect(element.querySelector('button')).toBeNull();
    expect(element.querySelectorAll('.skeleton')).toHaveLength(0);
    expect(element.querySelector('section')?.getAttribute('aria-busy')).toBe(
      'false',
    );
  });

  // @traces 1425-FR-003
  it('recovers tiles from a failed re-read on the next successful event', async () => {
    answer = async () => calm();
    const { element } = await open();

    answer = refuse(500);
    resync.next();
    await settle();
    const fresh = calm();
    fresh.tiles[2] = tile('maps', 'red', 'ro down', 'en down');
    answer = async () => fresh;
    resync.next();
    await settle();

    expect(tiles(element)[2].dataset['state']).toBe('red');
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });

  // @traces 1425-FR-005
  it('switches to the other language from the same answer without a re-read', async () => {
    answer = async () => calm();
    const { element, i18n } = await open();
    expect(text(tiles(element)[0].querySelector('.short'))).toBe('ro api');

    await i18n.use('en');
    await settle();

    expect(text(tiles(element)[0].querySelector('.short'))).toBe('en api');
    expect(text(tiles(element)[0].querySelector('.name'))).toBe('API');
    expect(sentences(element)).toEqual(['All services work normally.']);
    expect(reads).toBe(1);
  });

  // @traces 1425-FR-005
  it('shows no sentence and invents none when sentences are empty', async () => {
    const empty = calm();
    empty.sentences = { en: [], ro: [] };
    answer = async () => empty;
    const { element } = await open();

    expect(sentences(element)).toEqual([]);
    expect(tiles(element)).toHaveLength(6);
  });

  // @traces 1425-FR-005
  it('shows no sentence in English when only the Romanian list has any', async () => {
    const lopsided = calm();
    lopsided.sentences = { en: [], ro: ['doar română'] };
    answer = async () => lopsided;
    const { element } = await open('en');

    expect(sentences(element)).toEqual([]);
  });

  // @traces 1425-FR-005
  it('shows a hundred sentences each as its own line in the order answered', async () => {
    const many = calm();
    many.sentences.ro = Array.from({ length: 100 }, (_, i) => `rând ${i}`);
    answer = async () => many;
    const { element } = await open();

    expect(sentences(element)).toEqual(many.sentences.ro);
  });

  // @traces 1425-FR-004
  it('draws the tiles in the order given and never reorders them', async () => {
    const shuffled = calm();
    shuffled.tiles.reverse();
    answer = async () => shuffled;
    const { element } = await open();

    expect(tiles(element).map((t) => text(t.querySelector('.name')))).toEqual([
      'Backup',
      'Notificări',
      'E‑mail',
      'Hărți',
      'Căutare',
      'API',
    ]);
  });

  // @traces 1425-FR-004
  it('shows markup in a short state or sentence as plain text', async () => {
    const hostile = calm();
    hostile.tiles[0] = tile(
      'api',
      'red',
      '<img src=x onerror=alert(1)>',
      '<b>bold</b>',
    );
    hostile.sentences.ro = ['<script>alert(1)</script>'];
    answer = async () => hostile;
    const { element } = await open();

    expect(element.querySelector('img, script, b')).toBeNull();
    expect(text(tiles(element)[0].querySelector('.short'))).toBe(
      '<img src=x onerror=alert(1)>',
    );
    expect(sentences(element)).toEqual(['<script>alert(1)</script>']);
  });

  // @traces 1425-FR-004
  it('shows an empty short state as an empty text without breaking the tile', async () => {
    const blank = calm();
    blank.tiles[3] = tile('email', 'amber', '', '', {
      checkedAt: null,
      since: null,
    });
    answer = async () => blank;
    const { element } = await open();

    const item = tiles(element)[3];
    expect(text(item.querySelector('.name'))).toBe('E‑mail');
    expect(text(item.querySelector('.word'))).toBe('degradat');
    expect(text(item.querySelector('.short'))).toBe('');
    expect(item.dataset['state']).toBe('amber');
  });

  // @traces 1425-FR-004
  it('shows a very long short state in full', async () => {
    const long = 'x'.repeat(5000);
    const answered = calm();
    answered.tiles[0] = tile('api', 'green', long, long);
    answer = async () => answered;
    const { element } = await open();

    expect(text(tiles(element)[0].querySelector('.short'))).toBe(long);
  });

  // @traces 1425-FR-004
  it('shows a tile with the same short state as its lamp word, both texts', async () => {
    const answered = calm();
    answered.tiles[5] = tile('backup', 'red', 'căzut', 'down');
    answer = async () => answered;
    const { element } = await open();

    const item = tiles(element)[5];
    expect(text(item.querySelector('.word'))).toBe('căzut');
    expect(text(item.querySelector('.short'))).toBe('căzut');
  });

  // @traces 1425-FR-007
  it('keeps the same live region node when a re-read changes the sentences', async () => {
    answer = async () => calm();
    const { element } = await open();
    const region = element.querySelector('[aria-live]');

    const next = calm();
    next.sentences.ro = ['Altă propoziție.'];
    answer = async () => next;
    resync.next();
    await settle();

    expect(element.querySelector('[aria-live]')).toBe(region);
    expect(sentences(element)).toEqual(['Altă propoziție.']);
  });

  // @traces 1425-FR-007
  it('shows no sentence and no alert while the first read is out', async () => {
    answer = () => new Promise(() => undefined);
    const { element } = await open();

    expect(sentences(element)).toEqual([]);
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });

  // @traces 1425-FR-007
  it('makes no tile or sentence a focus stop and leaves Reîncearcă the only button', async () => {
    answer = async () => calm();
    const { element } = await open();

    expect(element.querySelectorAll('button, a, [tabindex]')).toHaveLength(0);
  });

  // @traces 1425-FR-004
  it('draws exactly six skeletons and no tile when the first read is out, in English too', async () => {
    answer = () => new Promise(() => undefined);
    const { element } = await open('en');

    expect(element.querySelectorAll('.skeleton')).toHaveLength(6);
    expect(text(element.querySelector('h2'))).toBe('System status');
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });
});
