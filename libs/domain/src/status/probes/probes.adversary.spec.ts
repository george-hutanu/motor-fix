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

function deps(over: Partial<ProbeDeps> = {}): ProbeDeps {
  let clock = 0;
  return {
    backup: async () => new Date('2026-10-17T07:00:00Z'),
    brevo: { checkKey: async () => true },
    clock: () => {
      clock += 40;
      return clock;
    },
    fetch: (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/brands/popular')) return json([{ slug: 'dacia' }]);
      if (url.includes('/search/garages')) return json({ items: [] });
      return json({ status: 'ok' });
    }) as typeof fetch,
    now: () => now,
    oldestWaiting: async () => null,
    places: {
      name: 'stub',
      search: async () => ({ items: [{ label: 'x', lat: 1, lng: 2 }] }),
    },
    sends: async () => ({ failed: 0, sent: 0 }),
    webUrl: new URL('https://motorfix.test'),
    ...over,
  };
}

const never = () => new Promise<never>(() => undefined);

// @traces 294-FR-002
describe('a probe that throws', () => {
  it.each([
    [
      'api',
      {
        fetch: (() => {
          throw new Error('sync boom');
        }) as unknown as typeof fetch,
      },
    ],
    [
      'api',
      {
        fetch: (async () => {
          throw new TypeError('fetch failed');
        }) as typeof fetch,
      },
    ],
    [
      'search',
      {
        fetch: (async () => {
          throw new Error('dns');
        }) as typeof fetch,
      },
    ],
    [
      'maps',
      {
        places: {
          name: 's',
          search: async () => {
            throw new Error('quota');
          },
        },
      },
    ],
    [
      'email',
      {
        brevo: {
          checkKey: async () => {
            throw new Error('brevo');
          },
        },
      },
    ],
    [
      'email',
      {
        sends: async () => {
          throw new Error('db');
        },
      },
    ],
    [
      'notifications',
      {
        sends: async () => {
          throw new Error('db');
        },
      },
    ],
    [
      'notifications',
      {
        oldestWaiting: async () => {
          throw new Error('redis');
        },
      },
    ],
    [
      'backup',
      {
        backup: async () => {
          throw new Error('s3');
        },
      },
    ],
  ] as [Parameters<typeof probe>[0], Partial<ProbeDeps>][])(
    'resolves to a failed check for %s',
    async (tile, over) => {
      const result = await probe(tile, deps(over));
      expect(result).toEqual({ ok: false, reason: expect.any(String) });
    },
  );

  it.each([
    ['a string', 'plain string'],
    ['null', null],
    ['undefined', undefined],
    ['an object', { code: 5 }],
  ])('resolves to a failed check when %s is thrown', async (_, thrown) => {
    const result = await probe(
      'backup',
      deps({
        backup: async () => {
          throw thrown;
        },
      }),
    );
    expect(result).toEqual({ ok: false, reason: expect.any(String) });
  });

  it('adds no latency to a failed check', async () => {
    const result = await probe(
      'api',
      deps({ fetch: (async () => json({}, 500)) as typeof fetch }),
    );
    expect(result).not.toHaveProperty('latencyMs');
  });

  it('does not let one failing probe stop another run on the same deps', async () => {
    const d = deps({
      brevo: {
        checkKey: async () => {
          throw new Error('down');
        },
      },
    });
    const results = await Promise.all([
      probe('email', d),
      probe('api', d),
      probe('backup', d),
    ]);
    expect(results.map((r) => r.ok)).toEqual([false, true, true]);
  });
});

// @traces 294-FR-002
describe('probes that never answer', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const settle = async (promise: Promise<unknown>, ms: number) => {
    let state: 'pending' | 'done' = 'pending';
    void promise.then(() => {
      state = 'done';
    });
    await jest.advanceTimersByTimeAsync(ms);
    return state;
  };

  it.each([
    ['search', { fetch: (() => never()) as unknown as typeof fetch }],
    ['maps', { places: { name: 's', search: () => never() } }],
    ['email', { brevo: { checkKey: () => never() } }],
    ['notifications', { oldestWaiting: () => never() }],
    ['notifications', { sends: () => never() }],
    ['email', { sends: () => never() }],
  ] as [Parameters<typeof probe>[0], Partial<ProbeDeps>][])(
    'fails %s with a timeout at ten seconds and not before',
    async (tile, over) => {
      const result = probe(tile, deps(over));
      expect(await settle(result, 9_999)).toBe('pending');
      expect(await settle(result, 1)).toBe('done');
      expect(await result).toEqual({ ok: false, reason: 'timeout' });
    },
  );

  it('fails the backup probe with a timeout and aborts the signal it was given', async () => {
    let signal: AbortSignal | undefined;
    const result = probe(
      'backup',
      deps({
        backup: (s) => {
          signal = s;
          return never();
        },
      }),
    );
    await jest.advanceTimersByTimeAsync(10_000);
    expect(await result).toEqual({ ok: false, reason: 'timeout' });
    expect(signal?.aborted).toBe(true);
  });

  it('times out a search whose second call hangs after a fast first call', async () => {
    const result = probe(
      'search',
      deps({
        fetch: ((input: string | URL | Request) =>
          String(input).includes('popular')
            ? Promise.resolve(json([{ slug: 'dacia' }]))
            : never()) as unknown as typeof fetch,
      }),
    );
    await jest.advanceTimersByTimeAsync(10_000);
    expect(await result).toEqual({ ok: false, reason: 'timeout' });
  });

  it('does not count a slow-but-answered call as a timeout when it answers at nine seconds', async () => {
    const result = probe(
      'maps',
      deps({
        places: {
          name: 's',
          search: () =>
            new Promise((resolve) =>
              setTimeout(() => resolve({ items: [] }), 9_000),
            ),
        },
      }),
    );
    await jest.advanceTimersByTimeAsync(9_000);
    expect(await result).toMatchObject({ ok: true });
  });
});

// @traces 294-FR-003
describe('the probes against odd answers', () => {
  it.each([
    ['not JSON at all', () => new Response('<html>', { status: 200 })],
    ['an object instead of a list', () => json({ slug: 'dacia' })],
    ['a brand without a slug', () => json([{ name: 'Dacia' }])],
    ['null', () => json(null)],
  ])('fails the search probe when the brand list is %s', async (_, make) => {
    const result = await probe(
      'search',
      deps({ fetch: (async () => make()) as typeof fetch }),
    );
    expect(result).toEqual({ ok: false, reason: expect.any(String) });
  });

  it.each([201, 204, 301, 404, 500, 503])(
    'fails the api probe on status %s',
    async (status) => {
      const result = await probe(
        'api',
        deps({
          fetch: (async () =>
            new Response(null, { status })) as unknown as typeof fetch,
        }),
      );
      expect(result).toEqual({ ok: false, reason: `http_${status}` });
    },
  );

  it('adds no trailing double slash when the public address ends with a slash', async () => {
    const urls: string[] = [];
    await probe(
      'api',
      deps({
        fetch: (async (input: string | URL | Request) => {
          urls.push(String(input));
          return json({});
        }) as typeof fetch,
        webUrl: new URL('https://motorfix.test/'),
      }),
    );
    expect(urls).toEqual(['https://motorfix.test/health/ready']);
  });

  it('fails the search probe when the public address is not set', async () => {
    expect(await probe('search', deps({ webUrl: undefined }))).toEqual({
      ok: false,
      reason: 'not_configured',
    });
  });

  it('gives a failed share of 1 for one failed send of one', async () => {
    expect(
      await probe(
        'email',
        deps({ sends: async () => ({ failed: 1, sent: 0 }) }),
      ),
    ).toMatchObject({ figures: { failed_share: 1 }, ok: true });
  });

  it('gives a share of 1 when every send failed', async () => {
    expect(
      await probe(
        'email',
        deps({ sends: async () => ({ failed: 7, sent: 0 }) }),
      ),
    ).toMatchObject({ figures: { failed_share: 1 } });
  });

  it('gives a share of 0, never NaN, with no sends in the window', async () => {
    const result = await probe('notifications', deps());
    expect(result).toMatchObject({ figures: { failed_share: 0 }, ok: true });
  });

  it('gives a share of 0 when sends all succeeded', async () => {
    expect(
      await probe(
        'email',
        deps({ sends: async () => ({ failed: 0, sent: 40 }) }),
      ),
    ).toMatchObject({ figures: { failed_share: 0 } });
  });

  it('asks for sends since exactly fifteen minutes before now', async () => {
    const since: Date[] = [];
    await probe(
      'notifications',
      deps({
        sends: async (_, s) => {
          since.push(s);
          return { failed: 0, sent: 0 };
        },
      }),
    );
    expect(since).toEqual([new Date('2026-10-17T09:45:00Z')]);
  });

  it('gives a waiting age of 0 for a job added in the future (clock skew)', async () => {
    const result = await probe(
      'notifications',
      deps({ oldestWaiting: async () => now.getTime() + 60_000 }),
    );
    expect(result).toMatchObject({
      figures: { oldest_waiting_s: 0 },
      ok: true,
    });
  });

  it('gives the age of the oldest waiting job in whole seconds', async () => {
    const result = await probe(
      'notifications',
      deps({ oldestWaiting: async () => now.getTime() - 1 }),
    );
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(Number.isInteger(result.figures.oldest_waiting_s)).toBe(true);
    }
  });

  it('reports the age of a two-day-old backup as 48 hours', async () => {
    const result = await probe(
      'backup',
      deps({ backup: async () => new Date('2026-10-15T10:00:00Z') }),
    );
    expect(result).toMatchObject({ figures: { backup_age_h: 48 }, ok: true });
  });

  it('holds only figures, a time and a reason in the detail, never a url or a key', async () => {
    const result = await probe('backup', deps());
    expect(JSON.stringify(result)).not.toMatch(/https?:|secret|token/i);
  });
});

// @traces 294-FR-003
describe('which tiles are due', () => {
  const ago = (seconds: number) => ({
    checkedAt: new Date(now.getTime() - seconds * 1000),
  });

  it('probes maps on a run 60 seconds after its last check and not 30 seconds after', () => {
    expect(dueTiles(ago(30), now)).not.toContain('maps');
    expect(dueTiles(ago(60), now)).toContain('maps');
  });

  it('probes maps again after a long gap', () => {
    expect(dueTiles(ago(86_400), now)).toContain('maps');
  });

  it('skips maps on a run at the very same instant', () => {
    expect(dueTiles(ago(0), now)).not.toContain('maps');
  });

  it('does not probe maps when its last check lies in the future', () => {
    expect(dueTiles(ago(-600), now)).not.toContain('maps');
  });

  it('alternates maps across a 30 second schedule: first, skip, run, skip, run', () => {
    let maps: { checkedAt: Date } | null = null;
    const ran: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      const t = new Date(now.getTime() + i * 30_000);
      const due = dueTiles(maps, t).includes('maps');
      ran.push(due);
      if (due) maps = { checkedAt: t };
    }
    expect(ran).toEqual([true, false, true, false, true, false]);
  });

  it('still alternates when each run starts a second late', () => {
    let maps: { checkedAt: Date } | null = null;
    const ran: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      const t = new Date(now.getTime() + i * 30_000 + (i % 2) * 1_000);
      const due = dueTiles(maps, t).includes('maps');
      ran.push(due);
      if (due) maps = { checkedAt: t };
    }
    expect(ran).toEqual([true, false, true, false, true, false]);
  });

  it('still alternates when a run starts a second early', () => {
    let maps: { checkedAt: Date } | null = null;
    const ran: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      const t = new Date(now.getTime() + i * 30_000 - (i % 2) * 1_000);
      const due = dueTiles(maps, t).includes('maps');
      ran.push(due);
      if (due) maps = { checkedAt: t };
    }
    expect(ran).toEqual([true, false, true, false, true, false]);
  });

  it('lists the six tiles on the first run, each once', () => {
    expect([...dueTiles(null, now)].sort()).toEqual([
      'api',
      'backup',
      'email',
      'maps',
      'notifications',
      'search',
    ]);
  });
});

// @traces 294-FR-003
describe('the newest backup manifest', () => {
  const key = (name: string, iso: string) => ({
    Key: name,
    LastModified: new Date(iso),
  });

  // The nightly backup writes `<environment>/<stamp>.manifest.json` only, so
  // a bare manifest.json is not one of its copies.
  it('ignores a key named exactly manifest.json, which the backup never writes', () => {
    expect(
      newestManifest([key('production/manifest.json', '2026-10-17T03:00:00Z')]),
    ).toBeNull();
  });

  it('ignores a dump uploaded after an older manifest even though it is newer', () => {
    expect(
      newestManifest([
        key('production/a.manifest.json', '2026-10-16T03:00:00Z'),
        key('production/b.dump', '2026-10-17T03:00:00Z'),
      ]),
    ).toEqual(new Date('2026-10-16T03:00:00Z'));
  });

  it('ignores a key that only contains manifest.json in the middle', () => {
    expect(
      newestManifest([
        key('production/a.manifest.json.tmp', '2026-10-17T03:00:00Z'),
      ]),
    ).toBeNull();
  });

  it('ignores a key that has no name before the folder slash', () => {
    expect(
      newestManifest([key('production/', '2026-10-17T03:00:00Z')]),
    ).toBeNull();
  });

  it('returns the same newest whatever order the listing is in', () => {
    const a = key('production/a.manifest.json', '2026-10-15T03:00:00Z');
    const b = key('production/b.manifest.json', '2026-10-17T03:00:00Z');
    const c = key('production/c.manifest.json', '2026-10-16T03:00:00Z');
    expect(newestManifest([a, b, c])).toEqual(newestManifest([c, b, a]));
    expect(newestManifest([a, b, c])).toEqual(new Date('2026-10-17T03:00:00Z'));
  });

  it('skips a manifest whose LastModified is an invalid date', () => {
    expect(
      newestManifest([
        { Key: 'production/a.manifest.json', LastModified: new Date('nope') },
        key('production/b.manifest.json', '2026-10-16T03:00:00Z'),
      ]),
    ).toEqual(new Date('2026-10-16T03:00:00Z'));
  });

  it('is null when the only invalid-date manifest is all there is', () => {
    expect(
      newestManifest([
        { Key: 'production/a.manifest.json', LastModified: new Date('nope') },
      ]),
    ).toBeNull();
  });

  it('handles unicode and spaces in keys', () => {
    expect(
      newestManifest([
        key('production/săptămâna 42 ✓.manifest.json', '2026-10-17T03:00:00Z'),
      ]),
    ).toEqual(new Date('2026-10-17T03:00:00Z'));
  });

  it('finds the newest among ten thousand keys', () => {
    const many = Array.from({ length: 10_000 }, (_, i) => ({
      Key: `production/${i}.manifest.json`,
      LastModified: new Date(Date.UTC(2026, 0, 1) + i * 60_000),
    }));
    expect(newestManifest(many)).toEqual(many[9_999]?.LastModified);
  });

  it('builds no lister from an empty environment', () => {
    expect(backupLister('production', {})).toBeUndefined();
  });
});
