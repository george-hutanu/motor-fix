import {
  allClearSentence,
  STALE_AFTER_MS,
  type StatusTileView,
  statusTexts,
  TILES,
  type TileKey,
  type TileState,
} from './status-tiles';

// 12:00 in Bucharest on 1 Nov 2026 (winter time, UTC+2).
const NOW = new Date('2026-11-01T10:00:00Z');

const tile = (
  key: TileKey,
  state: TileState,
  over: Partial<StatusTileView> = {},
): StatusTileView => ({
  detail: {},
  key,
  since: new Date('2026-11-01T08:40:00Z'),
  stale: false,
  state,
  ...over,
});

const backup = (last: string | undefined, state: TileState = 'green') =>
  tile('backup', state, {
    detail: last === undefined ? {} : { last_backup_at: last },
  });

describe('status texts under attack', () => {
  // @traces 295-FR-003
  it('keeps the stale window at exactly three minutes and six tiles in panel order', () => {
    expect(STALE_AFTER_MS).toBe(180_000);
    expect([...TILES]).toEqual([
      'api',
      'search',
      'maps',
      'email',
      'notifications',
      'backup',
    ]);
  });

  describe('times in Europe/Bucharest', () => {
    // @traces 295-FR-005
    it.each([
      ['2026-11-01T08:40:00Z', '10:40'],
      ['2026-11-01T05:05:00Z', '07:05'],
      ['2026-10-31T22:30:00Z', '00:30'],
      ['2026-10-31T21:59:00Z', '23:59'],
      ['2026-07-01T07:40:00Z', '10:40'],
      ['2026-10-25T00:59:00Z', '03:59'],
      ['2026-10-25T01:00:00Z', '03:00'],
      ['2026-03-29T00:59:00Z', '02:59'],
      ['2026-03-29T01:00:00Z', '04:00'],
    ])('reads %s as %s in the red api sentence', (iso, hhmm) => {
      const { sentence } = statusTexts(
        tile('api', 'red', { since: new Date(iso) }),
        NOW,
      );
      expect(sentence?.ro).toBe(
        `Aplicația nu răspunde din ${hhmm}. Șoferii și service-urile nu o pot folosi.`,
      );
      expect(sentence?.en).toBe(
        `The app has not answered since ${hhmm}. Drivers and garages cannot use it.`,
      );
    });
  });

  describe('latency in the short state', () => {
    // @traces 295-FR-005
    it.each([
      [0, 'normal · 0 ms', 'normal · 0 ms'],
      [82, 'normal · 82 ms', 'normal · 82 ms'],
      [82.4, 'normal · 82 ms', 'normal · 82 ms'],
      [82.6, 'normal · 83 ms', 'normal · 83 ms'],
      [999.4, 'normal · 999 ms', 'normal · 999 ms'],
      [999.6, 'normal · 1,0 s', 'normal · 1.0 s'],
      [1000, 'normal · 1,0 s', 'normal · 1.0 s'],
      [1900, 'normal · 1,9 s', 'normal · 1.9 s'],
      [12345, 'normal · 12,3 s', 'normal · 12.3 s'],
    ])('reads %p ms as %s / %s', (ms, ro, en) => {
      const { short } = statusTexts(
        tile('search', 'green', { detail: { latency_ms: ms } }),
        NOW,
      );
      expect(short).toEqual({ en, ro });
    });

    // @traces 295-FR-005
    it('reads an amber maps tile at 1900 ms as lent / slow in seconds', () => {
      const { short } = statusTexts(
        tile('maps', 'amber', { detail: { latency_ms: 1900 } }),
        NOW,
      );
      expect(short).toEqual({ en: 'slow · 1.9 s', ro: 'lent · 1,9 s' });
    });

    // @traces 295-FR-005
    it('drops the figure when an api tile has no latency', () => {
      expect(statusTexts(tile('api', 'green'), NOW).short).toEqual({
        en: 'normal',
        ro: 'normal',
      });
      expect(statusTexts(tile('api', 'amber'), NOW).short).toEqual({
        en: 'slow',
        ro: 'lent',
      });
    });

    // @traces 295-FR-005
    it('shows no latency on a red tile even when one is stored', () => {
      expect(
        statusTexts(tile('api', 'red', { detail: { latency_ms: 9000 } }), NOW)
          .short,
      ).toEqual({ en: 'down', ro: 'căzut' });
    });

    // @traces 295-FR-005
    it('ignores a stored latency on email and notifications', () => {
      expect(
        statusTexts(
          tile('email', 'green', { detail: { latency_ms: 200 } }),
          NOW,
        ).short,
      ).toEqual({ en: 'normal', ro: 'normal' });
      expect(statusTexts(tile('email', 'amber'), NOW).short).toEqual({
        en: 'delays',
        ro: 'întârzieri',
      });
      expect(statusTexts(tile('notifications', 'amber'), NOW).short).toEqual({
        en: 'delays',
        ro: 'întârzieri',
      });
      expect(statusTexts(tile('notifications', 'red'), NOW).short).toEqual({
        en: 'down',
        ro: 'căzut',
      });
    });
  });

  describe('the backup tile', () => {
    // @traces 295-FR-005
    it('says today with the Bucharest clock, not the UTC date', () => {
      expect(statusTexts(backup('2026-10-31T22:30:00Z'), NOW).short).toEqual({
        en: 'last: 00:30',
        ro: 'ultimul: 00:30',
      });
    });

    // @traces 295-FR-005
    it('says yesterday one minute before Bucharest midnight', () => {
      expect(statusTexts(backup('2026-10-31T21:59:00Z'), NOW).short).toEqual({
        en: 'last: yesterday, 23:59',
        ro: 'ultimul: ieri, 23:59',
      });
    });

    // @traces 295-FR-005
    it('says the date for anything older than yesterday, without a year', () => {
      expect(statusTexts(backup('2026-10-02T00:00:00Z'), NOW).short).toEqual({
        en: 'last: 2 Oct, 03:00',
        ro: 'ultimul: 2 oct., 03:00',
      });
      expect(statusTexts(backup('2024-03-05T10:00:00Z'), NOW).short).toEqual({
        en: 'last: 5 Mar, 12:00',
        ro: 'ultimul: 5 mar., 12:00',
      });
    });

    // @traces 295-FR-005
    it('says never with no last_backup_at, in every state', () => {
      for (const state of ['green', 'amber', 'red'] as const) {
        expect(statusTexts(backup(undefined, state), NOW).short).toEqual({
          en: 'last: never',
          ro: 'ultimul: niciodată',
        });
      }
    });

    // @traces 295-FR-005
    it('keeps the last backup in the short state on an amber and a red tile', () => {
      for (const state of ['amber', 'red'] as const) {
        expect(
          statusTexts(backup('2026-11-01T01:00:00Z', state), NOW).short,
        ).toEqual({ en: 'last: 03:00', ro: 'ultimul: 03:00' });
      }
    });

    // @traces 295-FR-005
    it('gives the stale form, not the last backup, on a stale backup tile', () => {
      const stale = tile('backup', 'red', {
        detail: { last_backup_at: '2026-11-01T01:00:00Z' },
        since: new Date('2026-11-01T08:41:00Z'),
        stale: true,
      });
      expect(statusTexts(stale, NOW).short).toEqual({
        en: 'no data since 10:41',
        ro: 'fără date din 10:41',
      });
    });

    // @traces 295-FR-005
    it('words the sentence of a problem backup with its date and time', () => {
      for (const state of ['amber', 'red'] as const) {
        expect(
          statusTexts(backup('2026-10-02T00:00:00Z', state), NOW).sentence,
        ).toEqual({
          en: 'The last successful backup is from 2 Oct, 03:00.',
          ro: 'Ultimul backup reușit este din 2 oct., 03:00.',
        });
      }
    });

    // @traces 295-FR-005
    it('words the sentence of a problem backup that never ran', () => {
      expect(statusTexts(backup(undefined, 'red'), NOW).sentence).toEqual({
        en: 'There is no successful backup yet.',
        ro: 'Nu există încă un backup reușit.',
      });
    });

    // @traces 295-FR-005
    it('survives an unparseable last_backup_at without printing Invalid or NaN', () => {
      const out = statusTexts(backup('not a date'), NOW);
      expect(out.short.ro).not.toMatch(/Invalid|NaN|undefined/);
      expect(out.short.en).not.toMatch(/Invalid|NaN|undefined/);
    });
  });

  describe('stale tiles', () => {
    // @traces 295-FR-005
    it('says no data since the last check, and a different sentence from the red one', () => {
      const stale = tile('maps', 'red', {
        since: new Date('2026-11-01T08:41:00Z'),
        stale: true,
      });
      expect(statusTexts(stale, NOW)).toEqual({
        sentence: {
          en: 'No data on Maps since 10:41. The service may be in another state.',
          ro: 'Nu avem date despre Hărți din 10:41. Starea serviciului poate fi alta.',
        },
        short: { en: 'no data since 10:41', ro: 'fără date din 10:41' },
      });
    });

    // @traces 295-FR-005
    it('says there is no data yet for a tile with no row', () => {
      const none = tile('email', 'red', {
        detail: {},
        since: null,
        stale: true,
      });
      expect(statusTexts(none, NOW)).toEqual({
        sentence: {
          en: 'There is no data on E-mail yet.',
          ro: 'Nu avem încă date despre E-mail.',
        },
        short: { en: 'no data', ro: 'fără date' },
      });
    });

    // @traces 295-FR-005
    it.each([
      ['api', 'API', 'API'],
      ['search', 'Search', 'Căutare'],
      ['maps', 'Maps', 'Hărți'],
      ['email', 'E-mail', 'E-mail'],
      ['notifications', 'Notifications', 'Notificări'],
      ['backup', 'Backup', 'Backup'],
    ] as const)('names %s as %s / %s in the no-row sentence', (key, en, ro) => {
      const { sentence } = statusTexts(
        tile(key, 'red', { since: null, stale: true }),
        NOW,
      );
      expect(sentence).toEqual({
        en: `There is no data on ${en} yet.`,
        ro: `Nu avem încă date despre ${ro}.`,
      });
    });
  });

  describe('no problem', () => {
    // @traces 295-FR-005
    it('gives the all-clear sentence in both languages', () => {
      expect(allClearSentence).toEqual({
        en: 'All services are running normally.',
        ro: 'Toate serviciile merg normal.',
      });
    });

    // @traces 295-FR-005
    it.each(TILES)('gives no sentence for a green %s', (key) => {
      expect(statusTexts(tile(key, 'green'), NOW).sentence).toBeNull();
    });
  });

  describe('effect sentences of every problem tile', () => {
    const cases: [TileKey, TileState, string, string][] = [
      [
        'api',
        'amber',
        'The app has been slow since 10:40. Pages may load slowly.',
        'Aplicația răspunde lent din 10:40. Paginile se pot încărca greu.',
      ],
      [
        'search',
        'amber',
        'Search has been slow since 10:40. Results may appear late.',
        'Căutarea merge greu din 10:40. Rezultatele pot apărea cu întârziere.',
      ],
      [
        'search',
        'red',
        'Search has not worked since 10:40. Drivers cannot find garages.',
        'Căutarea nu merge din 10:40. Șoferii nu găsesc service-uri.',
      ],
      [
        'maps',
        'amber',
        'Maps have been slow since 10:40. Distance sorting may lag.',
        'Hărțile răspund lent din 10:40. Căutarea după distanță poate întârzia.',
      ],
      [
        'maps',
        'red',
        'Maps have not loaded since 10:40. Results show as a list only.',
        'Hărțile nu se încarcă din 10:40. Rezultatele apar doar ca listă.',
      ],
      [
        'email',
        'amber',
        'E-mails have been going out late since 10:40. Confirmations and verification results may be delayed.',
        'E-mailurile pleacă cu întârziere din 10:40. Confirmările și rezultatele verificării pot întârzia.',
      ],
      [
        'email',
        'red',
        'E-mails have not gone out since 10:40. Confirmations and verification results do not arrive.',
        'E-mailurile nu pleacă din 10:40. Confirmările și rezultatele verificării nu ajung.',
      ],
      [
        'notifications',
        'amber',
        'Notifications have been going out late since 10:40. Drivers and garages may hear about quotes and bookings later.',
        'Notificările pleacă cu întârziere din 10:40. Șoferii și service-urile pot afla mai târziu de oferte și programări.',
      ],
      [
        'notifications',
        'red',
        'Notifications have not gone out since 10:40. Drivers and garages do not hear about quotes and bookings.',
        'Notificările nu pleacă din 10:40. Șoferii și service-urile nu află de oferte și programări.',
      ],
    ];

    // @traces 295-FR-005
    it.each(cases)('words %s %s', (key, state, en, ro) => {
      expect(
        statusTexts(
          tile(key, state, { since: new Date('2026-11-01T08:40:00Z') }),
          NOW,
        ).sentence,
      ).toEqual({ en, ro });
    });
  });

  describe('the function itself', () => {
    // @traces 295-FR-005
    it('answers the same twice and leaves a frozen tile alone', () => {
      const frozen = Object.freeze(
        tile('maps', 'amber', { detail: Object.freeze({ latency_ms: 1900 }) }),
      );
      const first = statusTexts(frozen, NOW);
      expect(statusTexts(frozen, NOW)).toEqual(first);
      expect(frozen.detail).toEqual({ latency_ms: 1900 });
    });
  });
});
