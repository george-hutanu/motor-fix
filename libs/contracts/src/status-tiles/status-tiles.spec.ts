import {
  allClearSentence,
  STALE_AFTER_MS,
  type StatusTileView,
  statusTexts,
  TILES,
  type TileKey,
  type TileState,
} from './status-tiles';

// 13:00 in Bucharest (summer time, UTC+3).
const AT = new Date('2026-10-17T10:00:00Z');
// 10:40 in Bucharest.
const SINCE = new Date('2026-10-17T07:40:00Z');

const tile = (
  key: TileKey,
  state: TileState,
  over: Partial<StatusTileView> = {},
): StatusTileView => ({
  detail: {},
  key,
  since: SINCE,
  stale: false,
  state,
  ...over,
});

const texts = (view: StatusTileView, at = AT) => statusTexts(view, at);

// @traces 295-FR-002 295-FR-005 295-FR-008
describe('the status tiles', () => {
  it('keep the panel order', () => {
    expect(TILES).toEqual([
      'api',
      'search',
      'maps',
      'email',
      'notifications',
      'backup',
    ]);
  });

  it('call a tile stale after three minutes', () => {
    expect(STALE_AFTER_MS).toBe(180_000);
  });
});

// @traces 295-FR-005 295-FR-008
describe('the short state of a timed tile', () => {
  it.each(['api', 'search', 'maps'] as const)(
    'reads %s green with its latency in milliseconds',
    (key) => {
      expect(
        texts(tile(key, 'green', { detail: { latency_ms: 82 } })).short,
      ).toEqual({ en: 'normal · 82 ms', ro: 'normal · 82 ms' });
    },
  );

  it('rounds a latency to whole milliseconds', () => {
    expect(
      texts(tile('search', 'green', { detail: { latency_ms: 140.4 } })).short,
    ).toEqual({ en: 'normal · 140 ms', ro: 'normal · 140 ms' });
  });

  it('reads a latency from 1000 ms in seconds with one decimal, in each language', () => {
    expect(
      texts(tile('maps', 'amber', { detail: { latency_ms: 1900 } })).short,
    ).toEqual({ en: 'slow · 1.9 s', ro: 'lent · 1,9 s' });
  });

  it('reads seconds once the rounded latency reaches 1000 ms', () => {
    expect(
      texts(tile('api', 'amber', { detail: { latency_ms: 999.6 } })).short,
    ).toEqual({ en: 'slow · 1.0 s', ro: 'lent · 1,0 s' });
  });

  it('keeps milliseconds just under 1000', () => {
    expect(
      texts(tile('api', 'green', { detail: { latency_ms: 999.4 } })).short,
    ).toEqual({ en: 'normal · 999 ms', ro: 'normal · 999 ms' });
  });

  it.each(['api', 'search', 'maps'] as const)(
    'reads %s green and amber without a figure when no latency was stored',
    (key) => {
      expect([
        texts(tile(key, 'green')).short,
        texts(tile(key, 'amber', { detail: { reason: 'timeout' } })).short,
      ]).toEqual([
        { en: 'normal', ro: 'normal' },
        { en: 'slow', ro: 'lent' },
      ]);
    },
  );

  it.each(['api', 'search', 'maps'] as const)('reads %s red as down', (key) => {
    expect(
      texts(tile(key, 'red', { detail: { latency_ms: 6000 } })).short,
    ).toEqual({ en: 'down', ro: 'căzut' });
  });
});

// @traces 295-FR-005 295-FR-008
describe('the short state of a queue tile', () => {
  it.each(['email', 'notifications'] as const)(
    'reads %s as normal, delays or down',
    (key) => {
      expect([
        texts(tile(key, 'green', { detail: { failed_share: 0 } })).short,
        texts(tile(key, 'amber', { detail: { oldest_waiting_s: 400 } })).short,
        texts(tile(key, 'red', { detail: { failed_share: 0.6 } })).short,
      ]).toEqual([
        { en: 'normal', ro: 'normal' },
        { en: 'delays', ro: 'întârzieri' },
        { en: 'down', ro: 'căzut' },
      ]);
    },
  );
});

// @traces 295-FR-005 295-FR-008
describe('the short state of the backup tile', () => {
  const backup = (lastBackupAt: string, state: TileState = 'green') =>
    tile('backup', state, { detail: { last_backup_at: lastBackupAt } });

  it.each(['green', 'amber', 'red'] as const)(
    'reads a backup from today by its time alone when %s',
    (state) => {
      expect(texts(backup('2026-10-17T00:00:00.000Z', state)).short).toEqual({
        en: 'last: 03:00',
        ro: 'ultimul: 03:00',
      });
    },
  );

  it.each(['green', 'amber', 'red'] as const)(
    'reads a backup from yesterday as yesterday when %s',
    (state) => {
      expect(texts(backup('2026-10-16T00:00:00.000Z', state)).short).toEqual({
        en: 'last: yesterday, 03:00',
        ro: 'ultimul: ieri, 03:00',
      });
    },
  );

  it.each(['green', 'amber', 'red'] as const)(
    'reads an older backup by its day and month, without a year, when %s',
    (state) => {
      expect(texts(backup('2026-10-02T00:00:00.000Z', state)).short).toEqual({
        en: 'last: 2 Oct, 03:00',
        ro: 'ultimul: 2 oct., 03:00',
      });
    },
  );

  it('leaves the year out of a backup from another year', () => {
    expect(texts(backup('2025-10-02T00:00:00.000Z', 'red')).short).toEqual({
      en: 'last: 2 Oct, 03:00',
      ro: 'ultimul: 2 oct., 03:00',
    });
  });

  it.each(['green', 'amber', 'red'] as const)(
    'reads never when no backup was recorded and the tile is %s',
    (state) => {
      expect(
        texts(tile('backup', state, { detail: { reason: 'no_backup' } })).short,
      ).toEqual({ en: 'last: never', ro: 'ultimul: niciodată' });
    },
  );

  it('judges today and yesterday on the calendar day in Bucharest', () => {
    // 00:30 on 18 October in Bucharest; the backup ran at 03:00 on the 17th.
    const lateAt = new Date('2026-10-17T21:30:00Z');

    expect(texts(backup('2026-10-17T00:00:00.000Z'), lateAt).short).toEqual({
      en: 'last: yesterday, 03:00',
      ro: 'ultimul: ieri, 03:00',
    });
  });

  it('reads the time in Bucharest after the clocks go back', () => {
    // 03:00 on 2 November in Bucharest is 01:00 UTC (winter time, UTC+2).
    const winterAt = new Date('2026-11-02T10:00:00Z');

    expect(texts(backup('2026-11-02T01:00:00.000Z'), winterAt).short).toEqual({
      en: 'last: 03:00',
      ro: 'ultimul: 03:00',
    });
  });
});

// @traces 295-FR-003 295-FR-005 295-FR-008
describe('the short state of a stale tile', () => {
  it.each(TILES)('reads %s as no data since its last check', (key) => {
    expect(
      texts(
        tile(key, 'red', {
          detail: {
            last_backup_at: '2026-10-17T00:00:00.000Z',
            latency_ms: 80,
          },
          since: new Date('2026-10-17T07:41:00Z'),
          stale: true,
        }),
      ).short,
    ).toEqual({ en: 'no data since 10:41', ro: 'fără date din 10:41' });
  });

  it.each(TILES)('reads %s as no data when it was never checked', (key) => {
    expect(texts(tile(key, 'red', { since: null, stale: true })).short).toEqual(
      { en: 'no data', ro: 'fără date' },
    );
  });
});

// @traces 295-FR-005 295-FR-008
describe('the effect sentence of a tile', () => {
  it('has none for a green tile', () => {
    expect(TILES.map((key) => texts(tile(key, 'green')).sentence)).toEqual(
      TILES.map(() => null),
    );
  });

  it.each([
    [
      'api',
      'amber',
      'Aplicația răspunde lent din 10:40. Paginile se pot încărca greu.',
      'The app has been slow since 10:40. Pages may load slowly.',
    ],
    [
      'api',
      'red',
      'Aplicația nu răspunde din 10:40. Șoferii și service-urile nu o pot folosi.',
      'The app has not answered since 10:40. Drivers and garages cannot use it.',
    ],
    [
      'search',
      'amber',
      'Căutarea merge greu din 10:40. Rezultatele pot apărea cu întârziere.',
      'Search has been slow since 10:40. Results may appear late.',
    ],
    [
      'search',
      'red',
      'Căutarea nu merge din 10:40. Șoferii nu găsesc service-uri.',
      'Search has not worked since 10:40. Drivers cannot find garages.',
    ],
    [
      'maps',
      'amber',
      'Hărțile răspund lent din 10:40. Căutarea după distanță poate întârzia.',
      'Maps have been slow since 10:40. Distance sorting may lag.',
    ],
    [
      'maps',
      'red',
      'Hărțile nu se încarcă din 10:40. Rezultatele apar doar ca listă.',
      'Maps have not loaded since 10:40. Results show as a list only.',
    ],
    [
      'email',
      'amber',
      'E-mailurile pleacă cu întârziere din 10:40. Confirmările și rezultatele verificării pot întârzia.',
      'E-mails have been going out late since 10:40. Confirmations and verification results may be delayed.',
    ],
    [
      'email',
      'red',
      'E-mailurile nu pleacă din 10:40. Confirmările și rezultatele verificării nu ajung.',
      'E-mails have not gone out since 10:40. Confirmations and verification results do not arrive.',
    ],
    [
      'notifications',
      'amber',
      'Notificările pleacă cu întârziere din 10:40. Șoferii și service-urile pot afla mai târziu de oferte și programări.',
      'Notifications have been going out late since 10:40. Drivers and garages may hear about quotes and bookings later.',
    ],
    [
      'notifications',
      'red',
      'Notificările nu pleacă din 10:40. Șoferii și service-urile nu află de oferte și programări.',
      'Notifications have not gone out since 10:40. Drivers and garages do not hear about quotes and bookings.',
    ],
  ] as const)('says what %s %s means', (key, state, ro, en) => {
    expect(texts(tile(key, state)).sentence).toEqual({ en, ro });
  });

  it.each(['amber', 'red'] as const)(
    'gives the date and time of the last backup when the backup tile is %s',
    (state) => {
      expect(
        texts(
          tile('backup', state, {
            detail: { last_backup_at: '2026-10-02T00:00:00.000Z' },
          }),
        ).sentence,
      ).toEqual({
        en: 'The last successful backup is from 2 Oct, 03:00.',
        ro: 'Ultimul backup reușit este din 2 oct., 03:00.',
      });
    },
  );

  it.each(['amber', 'red'] as const)(
    'says there is no backup yet when the backup tile is %s without one',
    (state) => {
      expect(
        texts(tile('backup', state, { detail: { reason: 'no_backup' } }))
          .sentence,
      ).toEqual({
        en: 'There is no successful backup yet.',
        ro: 'Nu există încă un backup reușit.',
      });
    },
  );

  it.each([
    ['api', 'API', 'API'],
    ['search', 'Căutare', 'Search'],
    ['maps', 'Hărți', 'Maps'],
    ['email', 'E-mail', 'E-mail'],
    ['notifications', 'Notificări', 'Notifications'],
    ['backup', 'Backup', 'Backup'],
  ] as const)(
    'says there is no data on %s since its last check when stale',
    (key, ro, en) => {
      expect(
        texts(
          tile(key, 'red', {
            since: new Date('2026-10-17T07:41:00Z'),
            stale: true,
          }),
        ).sentence,
      ).toEqual({
        en: `No data on ${en} since 10:41. The service may be in another state.`,
        ro: `Nu avem date despre ${ro} din 10:41. Starea serviciului poate fi alta.`,
      });
    },
  );

  it.each([
    ['api', 'API', 'API'],
    ['notifications', 'Notificări', 'Notifications'],
    ['backup', 'Backup', 'Backup'],
  ] as const)(
    'says there is no data on %s yet when it was never checked',
    (key, ro, en) => {
      expect(
        texts(tile(key, 'red', { since: null, stale: true })).sentence,
      ).toEqual({
        en: `There is no data on ${en} yet.`,
        ro: `Nu avem încă date despre ${ro}.`,
      });
    },
  );

  it('reads the time of a problem in Bucharest', () => {
    // 23:50 UTC on 16 October is 02:50 on the 17th in Bucharest.
    expect(
      texts(tile('api', 'red', { since: new Date('2026-10-16T23:50:00Z') }))
        .sentence?.en,
    ).toBe(
      'The app has not answered since 02:50. Drivers and garages cannot use it.',
    );
  });
});

// @traces 295-FR-005 295-FR-008
describe('the all-clear sentence', () => {
  it('says every service runs normally, in each language', () => {
    expect(allClearSentence).toEqual({
      en: 'All services are running normally.',
      ro: 'Toate serviciile merg normal.',
    });
  });
});
