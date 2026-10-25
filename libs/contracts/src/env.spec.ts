// @traces 539-FR-003 875-FR-001 875-FR-002 875-FR-003
// @traces 879-FR-017 244-FR-004
// @traces 430-FR-004 430-FR-007
// @traces 1192-FR-008 1192-FR-011
import {
  brandLoadTimeoutMs,
  bunnyConfig,
  faroUrl,
  grafanaUrl,
  imageBaseUrl,
  mapTilesTileJsonUrl,
  originSecrets,
  outageWebhookToken,
  PLACES_ENV,
  photoConfig,
  placesApiKey,
  plausibleDomain,
  publicWebUrl,
  readEnv,
  STORAGE_ENV,
  submitTimeoutMs,
  telemetry,
} from './env';

describe('readEnv', () => {
  it('returns the required variables and defaults the release to dev', () => {
    const env = readEnv(['DATABASE_URL'], {
      APP_ENV: 'test',
      DATABASE_URL: 'postgresql://db',
    });

    expect(env).toEqual({
      APP_ENV: 'test',
      DATABASE_URL: 'postgresql://db',
      RELEASE_SHA: 'dev',
    });
  });

  it('keeps a release SHA that is set', () => {
    expect(readEnv([], { APP_ENV: 'staging', RELEASE_SHA: 'abc123' })).toEqual({
      APP_ENV: 'staging',
      RELEASE_SHA: 'abc123',
    });
  });

  it('names a missing variable without printing any value', () => {
    const run = () =>
      readEnv(['DATABASE_URL', 'REDIS_URL'], {
        APP_ENV: 'test',
        DATABASE_URL: 'postgresql://user:secret@db',
      });

    expect(run).toThrow('REDIS_URL');
    expect(run).not.toThrow(/secret/);
  });

  it('treats an empty variable as missing', () => {
    expect(() =>
      readEnv(['REDIS_URL'], { APP_ENV: 'test', REDIS_URL: '' }),
    ).toThrow('REDIS_URL');
  });

  it('reads the five storage variables', () => {
    const values = {
      STORAGE_ACCESS_KEY_ID: 'key',
      STORAGE_BUCKET: 'motorfix',
      STORAGE_ENDPOINT: 'https://store.example',
      STORAGE_REGION: 'eu-central-1',
      STORAGE_SECRET_ACCESS_KEY: 'secret',
    };

    expect(readEnv(STORAGE_ENV, { APP_ENV: 'test', ...values })).toEqual({
      APP_ENV: 'test',
      RELEASE_SHA: 'dev',
      ...values,
    });
  });

  it.each([
    'STORAGE_ENDPOINT',
    'STORAGE_REGION',
    'STORAGE_BUCKET',
    'STORAGE_ACCESS_KEY_ID',
    'STORAGE_SECRET_ACCESS_KEY',
  ])('refuses to start without %s and prints no value', (missing) => {
    const source: Record<string, string> = {
      APP_ENV: 'test',
      STORAGE_ACCESS_KEY_ID: 'key-value',
      STORAGE_BUCKET: 'bucket-value',
      STORAGE_ENDPOINT: 'endpoint-value',
      STORAGE_REGION: 'region-value',
      STORAGE_SECRET_ACCESS_KEY: 'secret-value',
    };
    delete source[missing];

    const run = () => readEnv(STORAGE_ENV, source);

    expect(run).toThrow(`missing environment variable ${missing}`);
    expect(run).not.toThrow(/-value/);
  });

  it('requires APP_ENV to be one of the four environments', () => {
    expect(() => readEnv([], {})).toThrow('APP_ENV');
    expect(() => readEnv([], { APP_ENV: 'prod' })).toThrow(
      'APP_ENV must be one of development, test, staging, production',
    );
  });
});

describe('publicWebUrl', () => {
  it('parses an absolute URL', () => {
    expect(
      publicWebUrl({ PUBLIC_WEB_URL: 'https://motorfix.ro/' })?.origin,
    ).toBe('https://motorfix.ro');
  });

  it('returns nothing when unset or empty', () => {
    expect(publicWebUrl({})).toBeUndefined();
    expect(publicWebUrl({ PUBLIC_WEB_URL: '' })).toBeUndefined();
  });

  it('names the variable, never the value, when it is not a URL', () => {
    expect(() => publicWebUrl({ PUBLIC_WEB_URL: 'secret-host' })).toThrow(
      new Error('PUBLIC_WEB_URL must be an absolute URL'),
    );
  });
});

describe('the send transaction timeout', () => {
  it('is 30 seconds when the variable is not set', () => {
    expect(submitTimeoutMs({})).toBe(30_000);
    expect(submitTimeoutMs({ LISTING_SUBMIT_TX_TIMEOUT_MS: '' })).toBe(30_000);
  });

  it('reads a positive whole number of milliseconds', () => {
    expect(submitTimeoutMs({ LISTING_SUBMIT_TX_TIMEOUT_MS: '45000' })).toBe(
      45_000,
    );
  });

  it.each(['0', '-5', '1.5', '30s', 'abc'])('refuses %s', (value) => {
    expect(() =>
      submitTimeoutMs({ LISTING_SUBMIT_TX_TIMEOUT_MS: value }),
    ).toThrow(/LISTING_SUBMIT_TX_TIMEOUT_MS/);
  });
});

// @traces 105-FR-013
describe('the brand load transaction timeout', () => {
  it('is 60 seconds when the variable is not set', () => {
    expect(brandLoadTimeoutMs({})).toBe(60_000);
    expect(brandLoadTimeoutMs({ BRAND_LOAD_TIMEOUT_MS: '' })).toBe(60_000);
  });

  it('reads a positive whole number of milliseconds', () => {
    expect(brandLoadTimeoutMs({ BRAND_LOAD_TIMEOUT_MS: '90000' })).toBe(90_000);
  });

  it.each(['0', '-5', '1.5', '60s', 'abc'])('refuses %s', (value) => {
    expect(() => brandLoadTimeoutMs({ BRAND_LOAD_TIMEOUT_MS: value })).toThrow(
      /BRAND_LOAD_TIMEOUT_MS/,
    );
  });
});

describe('faroUrl', () => {
  it('parses an absolute https URL', () => {
    expect(faroUrl({ FARO_URL: 'https://faro.example/collect/key' })).toBe(
      'https://faro.example/collect/key',
    );
  });

  it('accepts http for a local collector', () => {
    expect(faroUrl({ FARO_URL: 'http://localhost:12345/collect' })).toBe(
      'http://localhost:12345/collect',
    );
  });

  it('returns nothing when unset or empty', () => {
    expect(faroUrl({})).toBeUndefined();
    expect(faroUrl({ FARO_URL: '' })).toBeUndefined();
  });

  it.each([
    'not-a-url',
    'ftp://faro.example/collect/secret-key',
    '/collect/secret-key',
  ])('names the variable, never the value, for %s', (value) => {
    const run = () => faroUrl({ FARO_URL: value });

    expect(run).toThrow(new Error('FARO_URL must be an absolute http(s) URL'));
    expect(run).not.toThrow(/secret-key|not-a-url/);
  });
});

describe('plausibleDomain', () => {
  it('reads the site name the analytics count under', () => {
    expect(plausibleDomain({ PLAUSIBLE_DOMAIN: ' motorfix.ro ' })).toBe(
      'motorfix.ro',
    );
  });

  it('returns nothing when unset or empty, so analytics stay off', () => {
    expect(plausibleDomain({})).toBeUndefined();
    expect(plausibleDomain({ PLAUSIBLE_DOMAIN: '' })).toBeUndefined();
  });

  it.each(['https://motorfix.ro', 'motor fix', 'a"b'])(
    'refuses %s, which is not a bare domain',
    (value) => {
      expect(() => plausibleDomain({ PLAUSIBLE_DOMAIN: value })).toThrow(
        new Error('PLAUSIBLE_DOMAIN must be a domain name'),
      );
    },
  );
});

describe('grafanaUrl', () => {
  it('parses the stack URL', () => {
    expect(grafanaUrl({ GRAFANA_URL: 'https://stack.grafana.net' })).toBe(
      'https://stack.grafana.net/',
    );
  });

  it('returns nothing when unset or empty', () => {
    expect(grafanaUrl({})).toBeUndefined();
    expect(grafanaUrl({ GRAFANA_URL: '' })).toBeUndefined();
  });

  it.each(['stack-secret', 'ftp://stack-secret.grafana.net'])(
    'names the variable, never the value, for %s',
    (value) => {
      const run = () => grafanaUrl({ GRAFANA_URL: value });

      expect(run).toThrow(
        new Error('GRAFANA_URL must be an absolute http(s) URL'),
      );
      expect(run).not.toThrow(/stack-secret/);
    },
  );
});

describe('telemetry', () => {
  const endpoint = 'https://otlp.example/otlp';
  const header = 'Authorization=Basic c2VjcmV0LXRva2Vu';

  it('is off when no endpoint is set, whatever else is', () => {
    expect(telemetry({ APP_ENV: 'production' })).toBeUndefined();
    expect(
      telemetry({
        APP_ENV: 'production',
        OTEL_EXPORTER_OTLP_ENDPOINT: '',
        OTEL_EXPORTER_OTLP_HEADERS: header,
        OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc',
      }),
    ).toBeUndefined();
  });

  it('samples a fifth of traces in production, labelled with the environment', () => {
    expect(
      telemetry({
        APP_ENV: 'production',
        OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
        OTEL_EXPORTER_OTLP_HEADERS: header,
        OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
      }),
    ).toEqual({
      endpoint: new URL(endpoint),
      env: 'production',
      headers: header,
      protocol: 'http/protobuf',
      traceSampleRatio: 0.2,
    });
  });

  it.each(['development', 'test', 'staging'])(
    'samples every trace in %s and defaults the protocol to http/protobuf',
    (appEnv) => {
      expect(
        telemetry({
          APP_ENV: appEnv,
          OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
        }),
      ).toEqual({
        endpoint: new URL('http://localhost:4318'),
        env: appEnv,
        protocol: 'http/protobuf',
        traceSampleRatio: 1,
      });
    },
  );

  it.each(['secret-host', 'ftp://secret-host/otlp'])(
    'names the endpoint, never its value, when %s is not an http(s) URL',
    (value) => {
      expect(() =>
        telemetry({ APP_ENV: 'staging', OTEL_EXPORTER_OTLP_ENDPOINT: value }),
      ).toThrow(
        new Error(
          'OTEL_EXPORTER_OTLP_ENDPOINT must be an absolute http(s) URL',
        ),
      );
    },
  );

  it.each(['grpc', 'http/json'])('refuses the %s protocol', (protocol) => {
    expect(() =>
      telemetry({
        APP_ENV: 'staging',
        OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
        OTEL_EXPORTER_OTLP_PROTOCOL: protocol,
      }),
    ).toThrow(new Error('OTEL_EXPORTER_OTLP_PROTOCOL must be http/protobuf'));
  });

  it('never puts the headers in an error', () => {
    const run = () =>
      telemetry({
        APP_ENV: 'nowhere',
        OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
        OTEL_EXPORTER_OTLP_HEADERS: header,
      });

    expect(run).toThrow('APP_ENV');
    expect(run).not.toThrow(/c2VjcmV0/);
  });
});

// @traces 251-FR-005
describe('outageWebhookToken', () => {
  it('reads the token trimmed, and nothing when unset or blank', () => {
    expect(outageWebhookToken({ OUTAGE_WEBHOOK_TOKEN: ' t-1 ' })).toBe('t-1');
    expect(outageWebhookToken({})).toBeUndefined();
    expect(outageWebhookToken({ OUTAGE_WEBHOOK_TOKEN: ' ' })).toBeUndefined();
  });
});

describe('placesApiKey', () => {
  it('reads the address search key when it is set', () => {
    expect(placesApiKey({ GEOAPIFY_API_KEY: ' k-123 ' })).toBe('k-123');
  });

  it('is undefined when unset or blank, so the api still boots', () => {
    expect(placesApiKey({})).toBeUndefined();
    expect(placesApiKey({ GEOAPIFY_API_KEY: '  ' })).toBeUndefined();
  });

  it('names the one variable it reads', () => {
    expect(PLACES_ENV).toEqual(['GEOAPIFY_API_KEY']);
  });
});

describe('originSecrets', () => {
  it('reads every value of the list, trimmed, so a secret can be rotated', () => {
    expect(originSecrets({ ORIGIN_SECRET: ' old , new ' })).toEqual([
      'old',
      'new',
    ]);
    expect(originSecrets({ ORIGIN_SECRET: 'one' })).toEqual(['one']);
  });

  it('is empty when unset or blank, and drops empty entries', () => {
    expect(originSecrets({})).toEqual([]);
    expect(originSecrets({ ORIGIN_SECRET: ' ' })).toEqual([]);
    expect(originSecrets({ ORIGIN_SECRET: 'a,, ,b,' })).toEqual(['a', 'b']);
  });
});

describe('bunnyConfig', () => {
  it('reads the key and the pull zone when both are set', () => {
    expect(
      bunnyConfig({ BUNNY_API_KEY: ' k ', BUNNY_PULL_ZONE_ID: ' 42 ' }),
    ).toEqual({ apiKey: 'k', pullZoneId: '42' });
  });

  it('is undefined when either is missing or blank', () => {
    expect(bunnyConfig({})).toBeUndefined();
    expect(bunnyConfig({ BUNNY_API_KEY: 'k' })).toBeUndefined();
    expect(bunnyConfig({ BUNNY_PULL_ZONE_ID: '42' })).toBeUndefined();
    expect(
      bunnyConfig({ BUNNY_API_KEY: ' ', BUNNY_PULL_ZONE_ID: '42' }),
    ).toBeUndefined();
  });
});

describe('photoConfig', () => {
  it('keeps the photo job and worker at their defaults when nothing is set', () => {
    expect(photoConfig({})).toEqual({
      attempts: 3,
      concurrency: navigator.hardwareConcurrency,
      keepFailed: 100,
      maxInputPixels: 268_402_689,
    });
  });

  it('takes each limit from its variable', () => {
    expect(
      photoConfig({
        PHOTO_JOB_ATTEMPTS: '5',
        PHOTO_JOB_KEEP_FAILED: '20',
        PHOTO_MAX_INPUT_PIXELS: '50000000',
        PHOTO_WORKER_CONCURRENCY: '2',
      }),
    ).toEqual({
      attempts: 5,
      concurrency: 2,
      keepFailed: 20,
      maxInputPixels: 50_000_000,
    });
  });

  it.each(['0', '-3', 'many', '2.5', ' '])(
    'falls back to the default for %p',
    (value) => {
      expect(
        photoConfig({
          PHOTO_JOB_ATTEMPTS: value,
          PHOTO_JOB_KEEP_FAILED: value,
          PHOTO_MAX_INPUT_PIXELS: value,
          PHOTO_WORKER_CONCURRENCY: value,
        }),
      ).toEqual(photoConfig({}));
    },
  );
});

describe('imageBaseUrl', () => {
  it('serves variants from the API on the same origin when unset', () => {
    expect(imageBaseUrl({})).toBe('/api/v1/images');
    expect(imageBaseUrl({ IMAGE_BASE_URL: '' })).toBe('/api/v1/images');
  });

  it('takes an absolute address or a path, without a trailing slash', () => {
    expect(imageBaseUrl({ IMAGE_BASE_URL: 'https://img.motorfix.ro/' })).toBe(
      'https://img.motorfix.ro',
    );
    expect(
      imageBaseUrl({ IMAGE_BASE_URL: 'http://localhost:3000/api/v1/images' }),
    ).toBe('http://localhost:3000/api/v1/images');
    expect(imageBaseUrl({ IMAGE_BASE_URL: '/images/' })).toBe('/images');
  });

  it.each(['img.motorfix.ro', 'ftp://img.motorfix.ro', '//img.motorfix.ro'])(
    'refuses %p',
    (value) => {
      expect(() => imageBaseUrl({ IMAGE_BASE_URL: value })).toThrow(
        new Error(
          'IMAGE_BASE_URL must be an http(s) URL or a path starting with /',
        ),
      );
    },
  );
});

// @traces 1196-FR-007
describe('mapTilesTileJsonUrl', () => {
  it("uses OpenFreeMap's tiles when unset or empty", () => {
    expect(mapTilesTileJsonUrl({})).toBe(
      'https://tiles.openfreemap.org/planet',
    );
    expect(mapTilesTileJsonUrl({ MAP_TILES_TILEJSON_URL: '' })).toBe(
      'https://tiles.openfreemap.org/planet',
    );
  });

  it('reads off as no provider at all', () => {
    expect(mapTilesTileJsonUrl({ MAP_TILES_TILEJSON_URL: 'off' })).toBe('off');
  });

  it('takes another absolute http(s) TileJSON', () => {
    expect(
      mapTilesTileJsonUrl({
        MAP_TILES_TILEJSON_URL: 'http://localhost:8080/planet',
      }),
    ).toBe('http://localhost:8080/planet');
  });

  it.each(['tiles.example/planet', 'ftp://tiles.example/planet', 'OFF '])(
    'refuses %s, naming the variable',
    (value) => {
      expect(() =>
        mapTilesTileJsonUrl({ MAP_TILES_TILEJSON_URL: value }),
      ).toThrow(
        new Error(
          'MAP_TILES_TILEJSON_URL must be an absolute http(s) URL or off',
        ),
      );
    },
  );
});
