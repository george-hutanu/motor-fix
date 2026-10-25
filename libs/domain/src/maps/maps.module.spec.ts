import { MapsModule } from './maps.module';
import { StaticMapController } from './static-map/static-map.controller';
import { StaticMapRenderer } from './static-map/static-map.renderer';

// @traces 1196-FR-001 1196-FR-007
describe('the maps module', () => {
  it('serves the static map and renders it from the tiles it is given', () => {
    const module = MapsModule.register({ tileJsonUrl: 'off' });

    expect(module.controllers).toEqual([StaticMapController]);
    const renderer = module.providers?.find(
      (p) =>
        typeof p === 'object' &&
        'provide' in p &&
        p.provide === StaticMapRenderer,
    ) as { useValue: StaticMapRenderer };
    expect(renderer.useValue).toBeInstanceOf(StaticMapRenderer);
  });
});
