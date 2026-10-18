import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  AdminService,
  type SystemLogDto,
  type SystemLogEntryDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { filter, Subject } from 'rxjs';

import { AdminLog } from './admin-log';
import { Live } from '../live';

const entry = (
  n: number,
  extra: Partial<SystemLogEntryDto> = {},
): SystemLogEntryDto =>
  ({
    at: '2026-10-17T07:40:00.000Z',
    context: { version: `v${n}` },
    count: 1,
    id: `entry-${n}`,
    kind: 'deploy',
    message: `Deployed v${n}.`,
    severity: 'info',
    source: 'worker',
    ...extra,
  }) as SystemLogEntryDto;

const logOf = (...items: SystemLogEntryDto[]): SystemLogDto => ({
  items,
  nextCursor: null,
});

let events: Subject<LiveMessage>;
let resync: Subject<void>;
let asked: { from: string; limit?: number }[];
let answer: () => Promise<SystemLogDto>;

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
  asked = [];
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
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
          systemLogControllerList: (read: { from: string; limit?: number }) => {
            asked.push(read);
            return answer();
          },
        },
      },
    ],
  });
  const i18n = TestBed.inject(I18n);
  if (language === 'en') await i18n.use('en');
  await i18n.enter('admin');
  const fixture = TestBed.createComponent(AdminLog);
  document.body.append(fixture.nativeElement);
  await settle();
  return fixture.nativeElement as HTMLElement;
}

const lines = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLElement>('ol > li'),
];
const sentence = (line: HTMLElement) =>
  line.querySelector('.text')?.textContent?.trim();
const skeletons = (element: HTMLElement) =>
  element.querySelectorAll('.skeleton').length;
const added = (): LiveMessage =>
  ({
    at: new Date().toISOString(),
    id: 'new',
    kind: 'system_log.added',
  }) as unknown as LiveMessage;

afterEach(() => {
  TestBed.resetTestingModule();
  document.body.innerHTML = '';
  jest.useRealTimers();
});

describe('AdminLog', () => {
  // @traces 298-FR-003 298-FR-016
  it('is a section named Jurnal whose lines are a list', async () => {
    answer = async () => logOf(entry(1), entry(2));
    const element = await open();

    const section = element.querySelector('section') as HTMLElement;
    const heading = element.querySelector('h2') as HTMLElement;
    expect(heading.textContent?.trim()).toBe('Jurnal');
    expect(section.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(heading.id).not.toBe('');
    expect(lines(element)).toHaveLength(2);
  });

  // @traces 298-FR-003
  it("asks for today's entries from midnight in Bucharest, twenty at most", async () => {
    jest.useFakeTimers({
      doNotFake: ['setImmediate'],
      now: new Date('2026-10-17T12:00:00Z'),
    });
    answer = async () => logOf();
    const opening = open();
    await jest.advanceTimersByTimeAsync(50);
    await opening;

    expect(asked).toEqual([{ from: '2026-10-16T21:00:00.000Z' }]);
  });

  // @traces 299-FR-006
  it('offers the whole log through one link under the lines, and no page control', async () => {
    answer = async () =>
      logOf(...Array.from({ length: 20 }, (_, i) => entry(i + 1)));
    const element = await open();

    const links = element.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0].textContent?.trim()).toBe('Vezi tot jurnalul');
    expect(links[0].getAttribute('href')).toBe('/app/admin/log');
    const list = element.querySelector('ol') as HTMLElement;
    expect(
      list.compareDocumentPosition(links[0]) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(element.querySelector('button')).toBeNull();
  });

  // @traces 299-FR-006
  it('names the link to the whole log in English', async () => {
    answer = async () => logOf(entry(1));
    const element = await open('en');

    expect(element.querySelector('a')?.textContent?.trim()).toBe(
      'See the whole log',
    );
  });

  // @traces 298-FR-004 298-FR-016
  it('shows each time as HH:mm in Bucharest in a time element, keeping the server order', async () => {
    answer = async () =>
      logOf(
        entry(1, { at: '2026-10-17T07:40:59.000Z' }),
        entry(2, { at: '2026-10-17T07:40:00.000Z' }),
        entry(3, { at: '2026-10-16T21:05:00.000Z' }),
      );
    const element = await open();

    const times = lines(element).map(
      (l) => l.querySelector('time') as HTMLTimeElement,
    );
    expect(times.map((t) => t.textContent?.trim())).toEqual([
      '10:40',
      '10:40',
      '00:05',
    ]);
    expect(times[0].getAttribute('datetime')).toBe('2026-10-17T07:40:59.000Z');
    expect(lines(element).map(sentence)).toEqual([
      'Versiune nouă instalată: v1.',
      'Versiune nouă instalată: v2.',
      'Versiune nouă instalată: v3.',
    ]);
  });

  // @traces 298-FR-005
  it("writes each line in the admin's language", async () => {
    answer = async () =>
      logOf(
        entry(1, {
          context: { provider: 'brevo', status: 429 },
          kind: 'service_error',
          message: 'Brevo answered 429.',
          severity: 'error',
          source: 'email',
        }),
      );

    expect(sentence(lines(await open())[0])).toBe('Brevo a răspuns 429.');
    TestBed.resetTestingModule();
    expect(sentence(lines(await open('en'))[0])).toBe('Brevo answered 429.');
  });

  // @traces 298-FR-006
  it.each([
    ['error', 'red', 'Eroare', 'Error'],
    ['warning', 'amber', 'Avertisment', 'Warning'],
    ['info', 'grey', 'Info', 'Info'],
  ] as const)(
    'carries %s as a %s lamp named in words',
    async (severity, state, ro, en) => {
      answer = async () => logOf(entry(1, { severity }));

      const lampRo = lines(await open())[0].querySelector('mf-lamp');
      expect(lampRo?.getAttribute('data-state')).toBe(state);
      expect(lampRo?.textContent?.trim()).toBe(ro);

      TestBed.resetTestingModule();
      const lampEn = lines(await open('en'))[0].querySelector('mf-lamp');
      expect(lampEn?.textContent?.trim()).toBe(en);
    },
  );

  // @traces 298-FR-007
  it('marks a grouped entry with its count, read out in words', async () => {
    answer = async () =>
      logOf(
        entry(1, {
          context: { provider: 'brevo', status: 429 },
          count: 40,
          kind: 'service_error',
          severity: 'error',
          source: 'email',
        }),
        entry(2),
      );
    const [grouped, single] = lines(await open());

    const count = grouped.querySelector('.count') as HTMLElement;
    expect(count.querySelector('[aria-hidden="true"]')?.textContent).toBe(
      '×40',
    );
    expect(count.querySelector('.sr-only')?.textContent?.trim()).toBe(
      'de 40 de ori',
    );
    expect(single.querySelector('.count')).toBeNull();

    TestBed.resetTestingModule();
    const [groupedEn] = lines(await open('en'));
    expect(
      groupedEn.querySelector('.count .sr-only')?.textContent?.trim(),
    ).toBe('40 times');
  });

  it('says a small repeat count in the Romanian plural', async () => {
    answer = async () => logOf(entry(1, { count: 2 }));
    const [grouped] = lines(await open());

    expect(grouped.querySelector('.count .sr-only')?.textContent?.trim()).toBe(
      'de 2 ori',
    );
  });

  // @traces 298-FR-008 298-FR-016
  it('reads that there is nothing to report today, as plain text', async () => {
    answer = async () => logOf();
    const element = await open();

    expect(element.textContent).toContain('Nimic de semnalat azi.');
    expect(element.querySelector('[role="alert"]')).toBeNull();
    expect(element.querySelector('ol')).toBeNull();

    TestBed.resetTestingModule();
    expect((await open('en')).textContent).toContain(
      'Nothing to report today.',
    );
  });

  // @traces 298-FR-008 298-FR-015
  it('shows three line skeletons while the first read is on its way', async () => {
    answer = () => new Promise(() => undefined);
    const element = await open();

    expect(skeletons(element)).toBe(3);
    expect(lines(element)).toHaveLength(0);
  });

  // @traces 298-FR-015
  it('shows the loading state on the server and reads nothing there', async () => {
    answer = async () => logOf(entry(1));
    const element = await open('ro', 'server');

    expect(skeletons(element)).toBe(3);
    expect(asked).toEqual([]);
  });

  // @traces 298-FR-008 298-FR-016
  it('announces a failed first read and reads again on Retry', async () => {
    answer = async () => {
      throw new Error('down');
    };
    const element = await open();

    const alert = element.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent?.trim()).toBe('Nu am putut citi jurnalul.');
    const retry = element.querySelector('button') as HTMLButtonElement;
    expect(retry.textContent?.trim()).toBe('Reîncearcă');
    expect(retry.type).toBe('button');

    answer = async () => logOf(entry(1));
    retry.click();
    await settle();

    expect(element.querySelector('[role="alert"]')).toBeNull();
    expect(lines(element)).toHaveLength(1);
    expect(asked).toHaveLength(2);
  });

  // @traces 298-FR-008
  it('names the failure and Retry in English', async () => {
    answer = async () => {
      throw new Error('down');
    };
    const element = await open('en');

    expect(element.querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      'Could not read the log.',
    );
    expect(element.querySelector('button')?.textContent?.trim()).toBe('Retry');
  });

  // @traces 298-FR-009 298-FR-015
  it('re-reads on a new log entry, keeping the lines shown until the new ones arrive', async () => {
    answer = async () => logOf(entry(1));
    const element = await open();

    let arrive: (log: SystemLogDto) => void = () => undefined;
    answer = () => new Promise((resolve) => (arrive = resolve));
    events.next(added());
    await new Promise((resolve) => setTimeout(resolve, 350));
    await settle();

    expect(asked).toHaveLength(2);
    expect(lines(element).map(sentence)).toEqual([
      'Versiune nouă instalată: v1.',
    ]);
    expect(skeletons(element)).toBe(0);

    arrive(logOf(entry(2), entry(1)));
    await settle();

    expect(lines(element).map(sentence)).toEqual([
      'Versiune nouă instalată: v2.',
      'Versiune nouă instalată: v1.',
    ]);
  });

  // @traces 298-FR-009
  it('ignores live events of other kinds', async () => {
    answer = async () => logOf(entry(1));
    await open();

    events.next({ ...added(), kind: 'garage.approved' } as LiveMessage);
    await new Promise((resolve) => setTimeout(resolve, 350));
    await settle();

    expect(asked).toHaveLength(1);
  });

  // @traces 298-FR-009
  it('re-reads on the dashboard resync', async () => {
    answer = async () => logOf(entry(1));
    await open();

    resync.next();
    await settle();

    expect(asked).toHaveLength(2);
  });

  // @traces 298-FR-015
  it('leaves the lines as they were and shows no error when a re-read fails', async () => {
    answer = async () => logOf(entry(1));
    const element = await open();

    answer = async () => {
      throw new Error('down');
    };
    resync.next();
    await settle();

    expect(asked).toHaveLength(2);
    expect(lines(element).map(sentence)).toEqual([
      'Versiune nouă instalată: v1.',
    ]);
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });

  // @traces 298-FR-010
  it('re-reads at midnight in Bucharest from the new day, and again the next midnight', async () => {
    jest.useFakeTimers({
      doNotFake: ['setImmediate'],
      now: new Date('2026-10-17T20:59:00Z'),
    });
    answer = async () => logOf(entry(1));
    const opening = open();
    await jest.advanceTimersByTimeAsync(50);
    await opening;
    expect(asked.map((a) => a.from)).toEqual(['2026-10-16T21:00:00.000Z']);

    await jest.advanceTimersByTimeAsync(62_000);
    expect(asked.map((a) => a.from)).toEqual([
      '2026-10-16T21:00:00.000Z',
      '2026-10-17T21:00:00.000Z',
    ]);

    await jest.advanceTimersByTimeAsync(24 * 3_600_000);
    expect(asked.map((a) => a.from).at(-1)).toBe('2026-10-18T21:00:00.000Z');
  });

  // @traces 298-FR-010
  it('asks from the start of the current day on every re-read', async () => {
    jest.useFakeTimers({
      doNotFake: ['setImmediate'],
      now: new Date('2026-10-17T12:00:00Z'),
    });
    answer = async () => logOf();
    const opening = open();
    await jest.advanceTimersByTimeAsync(50);
    await opening;

    jest.setSystemTime(new Date('2026-10-17T22:30:00Z'));
    resync.next();
    await jest.advanceTimersByTimeAsync(50);

    expect(asked.at(-1)?.from).toBe('2026-10-17T21:00:00.000Z');
  });

  // @traces 298-FR-016
  it('announces no new line through a live region', async () => {
    answer = async () => logOf(entry(1));
    const element = await open();

    expect(element.querySelector('[aria-live]')).toBeNull();
  });
});
