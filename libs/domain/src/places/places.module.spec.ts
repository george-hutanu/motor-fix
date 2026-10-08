import { Logger } from '@nestjs/common';

import { PlacesModule, placesConfig } from './places.module';
import {
  PLACES_PROVIDER,
  type PlacesProvider,
} from './providers/places.provider';

describe('which address search the api uses', () => {
  it('uses Geoapify whenever its key is set', () => {
    expect(placesConfig('production', { GEOAPIFY_API_KEY: 'k' })).toEqual({
      apiKey: 'k',
      provider: 'geoapify',
    });
    expect(placesConfig('test', { GEOAPIFY_API_KEY: 'k' })).toEqual({
      apiKey: 'k',
      provider: 'geoapify',
    });
  });

  it('uses the stand-in in tests when no key is set', () => {
    expect(placesConfig('test', {})).toEqual({ provider: 'fake' });
  });

  it.each(['development', 'staging', 'production'] as const)(
    'has none in %s without a key',
    (appEnv) => {
      expect(placesConfig(appEnv, { GEOAPIFY_API_KEY: ' ' })).toEqual({
        provider: 'none',
      });
    },
  );
});

describe('the places module', () => {
  afterEach(() => jest.restoreAllMocks());

  const providerOf = (config: Parameters<typeof PlacesModule.register>[0]) => {
    const found = PlacesModule.register(config).providers?.find(
      (p) =>
        typeof p === 'object' &&
        'provide' in p &&
        p.provide === PLACES_PROVIDER,
    ) as { useValue: PlacesProvider };
    return found.useValue;
  };

  it('answers unavailable with no search configured, and says so once at boot', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    const provider = providerOf({ provider: 'none' });

    expect(await provider.search('Strada Exemplu', 'ro')).toEqual({
      unavailable: 'not_configured',
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('GEOAPIFY_API_KEY');
  });

  it('names the search it chose without its key', () => {
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    expect(providerOf({ apiKey: 'secret', provider: 'geoapify' }).name).toBe(
      'geoapify',
    );
    expect(providerOf({ provider: 'fake' }).name).toBe('fake');
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
  });
});
