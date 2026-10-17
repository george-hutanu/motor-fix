import {
  backupLister,
  dueTiles,
  newestManifest,
  type ProbeDeps,
  probe,
} from './probes';

const now = new Date('2026-10-17T10:00:00Z');

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });

// Each call to the clock moves it on 40 ms, so every timed call takes 40.
function deps(over: Partial<ProbeDeps> = {}): ProbeDeps & {
  urls: string[];
  signals: AbortSignal[];
} {
  const urls: string[] = [];
  const signals: AbortSignal[] = [];
  let clock = 0;
  return {
    backup: async () => new Date('2026-10-17T07:00:00Z'),
    brevo: { checkKey: async () => true },
    clock: () => {
      clock += 40;
      return clock;
    },
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      urls.push(url);
      if (init?.signal) signals.push(init.signal);
      if (url.includes('/brands/popular')) return json([{ slug: 'dacia' }]);
      if (url.includes('/search/garages')) return json({ items: [] });
      return json({ status: 'ok' });
    }) as typeof fetch,
    now: () => now,
    oldestWaiting: async () => null,
    places: {
      name: 'stub',
      search: async () => ({
        items: [{ label: 'Piața Unirii', lat: 1, lng: 2 }],
      }),
    },
    sends: async () => ({ failed: 0, sent: 0 }),
    signals,
    urls,
    webUrl: new URL('https://motorfix.test'),
    ...over,
  };
}

// @traces 294-FR-002
// @traces 294-FR-003
// @traces 294-FR-012
describe('the api probe', () => {
  it('times the web edge readiness check on the public address', async () => {
    const d = deps();
    expect(await probe('api', d)).toEqual({
      figures: {},
      latencyMs: 40,
      ok: true,
    });
    expect(d.urls).toEqual(['https://motorfix.test/health/ready']);
  });

  it('fails on an answer other than 200', async () => {
    const d = deps({ fetch: (async () => json({}, 503)) as typeof fetch });
    expect(await probe('api', d)).toEqual({ ok: false, reason: 'http_503' });
  });

  it('fails when the public address is not set', async () => {
    expect(await probe('api', deps({ webUrl: undefined }))).toEqual({
      ok: false,
      reason: 'not_configured',
    });
  });

  describe('past ten seconds', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('fails with a timeout and cancels the call', async () => {
      const d = deps({
        fetch: ((_: unknown, init?: RequestInit) => {
          if (init?.signal) d.signals.push(init.signal);
          return new Promise<Response>(() => undefined);
        }) as typeof fetch,
      });
      const result = probe('api', d);
      await jest.advanceTimersByTimeAsync(9_999);
      let settled = false;
      void result.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      expect(await result).toEqual({ ok: false, reason: 'timeout' });
      expect(d.signals[0]?.aborted).toBe(true);
    });
  });
});

describe('the search probe', () => {
  it('searches the first popular brand near Bucharest centre, without the log flag', async () => {
    const d = deps();
    expect(await probe('search', d)).toEqual({
      figures: {},
      latencyMs: 40,
      ok: true,
    });
    expect(d.urls[0]).toBe(
      'https://motorfix.test/api/v1/brands/popular?limit=1',
    );
    const search = new URL(d.urls[1] ?? '');
    expect(search.pathname).toBe('/api/v1/search/garages');
    expect(search.searchParams.get('brand')).toBe('dacia');
    expect(search.searchParams.get('near')).toBe('44.4268,26.1025');
    expect(search.searchParams.has('log')).toBe(false);
  });

  it('times the garage search only, not the brand look-up before it', async () => {
    let clock = 0;
    const d = deps({
      clock: () => clock,
      fetch: (async (input: string | URL | Request) => {
        if (String(input).includes('/brands/popular')) {
          clock += 500;
          return json([{ slug: 'dacia' }]);
        }
        clock += 70;
        return json({ items: [] });
      }) as typeof fetch,
    });
    expect(await probe('search', d)).toEqual({
      figures: {},
      latencyMs: 70,
      ok: true,
    });
  });

  it('fails when there is no brand to search for', async () => {
    const d = deps({ fetch: (async () => json([])) as typeof fetch });
    expect(await probe('search', d)).toEqual({ ok: false, reason: 'no_brand' });
  });

  it('fails when the search answers an error', async () => {
    const d = deps({
      fetch: (async (input: string | URL | Request) =>
        String(input).includes('popular')
          ? json([{ slug: 'dacia' }])
          : json({}, 500)) as typeof fetch,
    });
    expect(await probe('search', d)).toEqual({ ok: false, reason: 'http_500' });
  });
});

describe('the maps probe', () => {
  it('times one look-up on the map provider', async () => {
    const queries: string[] = [];
    const d = deps({
      places: {
        name: 'stub',
        search: async (q) => {
          queries.push(q);
          return { items: [] };
        },
      },
    });
    expect(await probe('maps', d)).toEqual({
      figures: {},
      latencyMs: 40,
      ok: true,
    });
    expect(queries).toHaveLength(1);
  });

  it('fails when the provider is unavailable', async () => {
    const d = deps({
      places: {
        name: 'stub',
        search: async () => ({ unavailable: 'provider_429' }),
      },
    });
    expect(await probe('maps', d)).toEqual({
      ok: false,
      reason: 'provider_429',
    });
  });

  it('runs on the first run, when the tile has no row', () => {
    expect(dueTiles(null, now)).toContain('maps');
  });

  it('runs every other 30-second run: skipped 30 s after its last check, run 60 s after', () => {
    const last = (seconds: number) => ({
      checkedAt: new Date(now.getTime() - seconds * 1000),
    });
    expect(dueTiles(last(30), now)).not.toContain('maps');
    expect(dueTiles(last(54), now)).not.toContain('maps');
    expect(dueTiles(last(55), now)).toContain('maps');
    expect(dueTiles(last(60), now)).toContain('maps');
    expect(dueTiles(last(600), now)).toContain('maps');
  });

  it('never skips the five other tiles', () => {
    expect(dueTiles({ checkedAt: now }, now)).toEqual([
      'api',
      'search',
      'email',
      'notifications',
      'backup',
    ]);
  });
});

describe('the email probe', () => {
  it('times the account check and gives the failed share of the last 15 minutes', async () => {
    const asked: unknown[] = [];
    const d = deps({
      sends: async (channels, since) => {
        asked.push([channels, since]);
        return { failed: 1, sent: 3 };
      },
    });
    expect(await probe('email', d)).toEqual({
      figures: { failed_share: 0.25 },
      latencyMs: 40,
      ok: true,
    });
    expect(asked).toEqual([[['email'], new Date('2026-10-17T09:45:00Z')]]);
  });

  it('gives a share of 0 when nothing was sent in the window', async () => {
    expect(await probe('email', deps())).toEqual({
      figures: { failed_share: 0 },
      latencyMs: 40,
      ok: true,
    });
  });

  it('fails when the provider does not answer the account check with success', async () => {
    const d = deps({ brevo: { checkKey: async () => false } });
    expect(await probe('email', d)).toEqual({
      ok: false,
      reason: 'provider_refused',
    });
  });

  it('fails when no provider key is set', async () => {
    expect(await probe('email', deps({ brevo: undefined }))).toEqual({
      ok: false,
      reason: 'not_configured',
    });
  });
});

describe('the notifications probe', () => {
  it('gives the oldest waiting job age and the failed push, SMS and WhatsApp share', async () => {
    const asked: unknown[] = [];
    const d = deps({
      oldestWaiting: async () => now.getTime() - 125_000,
      sends: async (channels) => {
        asked.push(channels);
        return { failed: 2, sent: 2 };
      },
    });
    expect(await probe('notifications', d)).toEqual({
      figures: { failed_share: 0.5, oldest_waiting_s: 125 },
      ok: true,
    });
    expect(asked).toEqual([['push', 'sms', 'whatsapp']]);
  });

  it('gives an age of 0 when nothing waits and a share of 0 with no sends', async () => {
    expect(await probe('notifications', deps())).toEqual({
      figures: { failed_share: 0, oldest_waiting_s: 0 },
      ok: true,
    });
  });
});

describe('the backup probe', () => {
  it('gives the hours since the newest manifest and when it was', async () => {
    expect(await probe('backup', deps())).toEqual({
      detail: { last_backup_at: '2026-10-17T07:00:00.000Z' },
      figures: { backup_age_h: 3 },
      ok: true,
    });
  });

  it('fails on an empty bucket', async () => {
    expect(await probe('backup', deps({ backup: async () => null }))).toEqual({
      ok: false,
      reason: 'no_backup',
    });
  });

  it('fails when the bucket settings are not set', async () => {
    expect(await probe('backup', deps({ backup: undefined }))).toEqual({
      ok: false,
      reason: 'not_configured',
    });
  });

  it('picks the newest manifest among the copies', () => {
    expect(
      newestManifest([
        {
          Key: 'production/2026-10-15T03-00-00Z.manifest.json',
          LastModified: new Date('2026-10-15T03:10:00Z'),
        },
        {
          Key: 'production/2026-10-17T03-00-00Z.dump.gpg',
          LastModified: new Date('2026-10-17T03:09:00Z'),
        },
        {
          Key: 'production/2026-10-16T03-00-00Z.manifest.json',
          LastModified: new Date('2026-10-16T03:10:00Z'),
        },
        { Key: 'production/broken.manifest.json' },
      ]),
    ).toEqual(new Date('2026-10-16T03:10:00Z'));
    expect(newestManifest([])).toBeNull();
    expect(newestManifest(undefined)).toBeNull();
  });

  it('builds no lister unless all five bucket settings are set', () => {
    const full = {
      BACKUP_S3_ACCESS_KEY_ID: 'id',
      BACKUP_S3_BUCKET: 'backups',
      BACKUP_S3_ENDPOINT: 'https://s3.example.test',
      BACKUP_S3_REGION: 'auto',
      BACKUP_S3_SECRET_ACCESS_KEY: 'secret',
    };
    const lister = backupLister('production', full);
    expect(lister?.list).toBeInstanceOf(Function);
    lister?.destroy();
    for (const name of Object.keys(full)) {
      expect(
        backupLister('production', { ...full, [name]: '' }),
      ).toBeUndefined();
    }
  });
});

describe('any probe', () => {
  it('turns a throw into a failed check instead of rejecting', async () => {
    const d = deps({
      oldestWaiting: async () => {
        throw new Error('store down');
      },
    });
    await expect(probe('notifications', d)).resolves.toEqual({
      ok: false,
      reason: 'store down',
    });
  });
});

describe('a provider call past ten seconds', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const hang = () => new Promise<never>(() => undefined);

  it('cancels the map look-up, so it uses no more provider quota', async () => {
    let signal: AbortSignal | undefined;
    const result = probe(
      'maps',
      deps({
        places: {
          name: 'stub',
          search: (_q, _lang, s) => {
            signal = s;
            return hang();
          },
        },
      }),
    );
    await jest.advanceTimersByTimeAsync(10_000);
    expect(await result).toEqual({ ok: false, reason: 'timeout' });
    expect(signal?.aborted).toBe(true);
  });

  it('cancels the e-mail account check', async () => {
    let signal: AbortSignal | undefined;
    const result = probe(
      'email',
      deps({
        brevo: {
          checkKey: (s) => {
            signal = s;
            return hang();
          },
        },
      }),
    );
    await jest.advanceTimersByTimeAsync(10_000);
    expect(await result).toEqual({ ok: false, reason: 'timeout' });
    expect(signal?.aborted).toBe(true);
  });
});
