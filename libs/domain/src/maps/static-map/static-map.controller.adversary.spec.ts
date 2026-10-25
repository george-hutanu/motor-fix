import {
  STATIC_MAP_CACHE_CONTROL,
  StaticMapQueryDto,
} from '@motor-fix/contracts';
import { snapCentre } from '@motor-fix/contracts/map-view';
import {
  BadRequestException,
  type CallHandler,
  type ExecutionContext,
  HttpException,
  StreamableFile,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { lastValueFrom, of, throwError } from 'rxjs';

import { StaticMapAnswers, StaticMapController } from './static-map.controller';
import { MapTilesUnavailable, StaticMapRenderer } from './static-map.renderer';
import type { RateLimits } from '../../rate-limit/rate-limit.service';

const query = (over: Partial<StaticMapQueryDto> = {}): StaticMapQueryDto =>
  Object.assign(new StaticMapQueryDto(), {
    h: 480,
    lat: 44.42681,
    lng: 26.10254,
    theme: 'light',
    w: 640,
    z: 13,
    ...over,
  });

function response() {
  const headers = new Map<string, string>();
  return {
    headers,
    res: {
      getHeader: (k: string) => headers.get(k),
      setHeader: (k: string, v: string) => {
        headers.set(k, v);
      },
    } as unknown as Response,
  };
}

const webp = Buffer.from('RIFF....WEBP');
const setup = () => {
  const render = jest.fn<
    Promise<Buffer>,
    Parameters<StaticMapRenderer['render']>
  >();
  const take = jest.fn<Promise<void>, [string, string]>();
  const controller = new StaticMapController(
    { render } as unknown as StaticMapRenderer,
    { take } as unknown as RateLimits,
  );
  return { controller, render, take };
};

// @traces 1196-FR-001 1196-FR-002 1196-FR-005 1196-FR-008
describe('StaticMapController, hostile calls', () => {
  it('renders at the snapped centre and names the same centre in the headers', async () => {
    const { controller, render } = setup();
    render.mockResolvedValue(webp);
    const { res, headers } = response();

    const file = await controller.render(
      query(),
      { ip: '1.2.3.4' } as Request,
      res,
    );

    const snapped = snapCentre({ lat: 44.42681, lng: 26.10254 }, 13, 640);
    expect(render).toHaveBeenCalledWith({
      h: 480,
      theme: 'light',
      w: 640,
      z: 13,
      ...snapped,
    });
    expect(headers.get('X-Map-Lat')).toBe(String(snapped.lat));
    expect(headers.get('X-Map-Lng')).toBe(String(snapped.lng));
    expect(headers.get('Cache-Control')).toBe(STATIC_MAP_CACHE_CONTROL);
    expect(file).toBeInstanceOf(StreamableFile);
    expect(file.getHeaders().type).toBe('image/webp');
  });

  it('renders two centres in one cell as the same view', async () => {
    const { controller, render } = setup();
    render.mockResolvedValue(webp);

    await controller.render(query(), { ip: 'a' } as Request, response().res);
    await controller.render(
      query({ lat: 44.4269, lng: 26.1026 }),
      { ip: 'a' } as Request,
      response().res,
    );

    expect(render.mock.calls[1][0]).toEqual(render.mock.calls[0][0]);
  });

  it('takes the staticMap limit for the caller address before it renders, and renders nothing when refused', async () => {
    const { controller, render, take } = setup();
    take.mockRejectedValue(new HttpException('rate_limited', 429));

    await expect(
      controller.render(query(), { ip: '9.9.9.9' } as Request, response().res),
    ).rejects.toMatchObject({ status: 429 });

    expect(take).toHaveBeenCalledWith('staticMap', '9.9.9.9');
    expect(render).not.toHaveBeenCalled();
  });

  it('takes the limit under an empty address when the request has none', async () => {
    const { controller, render, take } = setup();
    render.mockResolvedValue(webp);

    await controller.render(query(), {} as Request, response().res);

    expect(take).toHaveBeenCalledWith('staticMap', '');
  });

  it('never sets the long cache life when the renderer fails', async () => {
    const { controller, render } = setup();
    render.mockRejectedValue(new MapTilesUnavailable('x'));
    const { res, headers } = response();

    await expect(
      controller.render(query(), { ip: 'a' } as Request, res),
    ).rejects.toBeInstanceOf(MapTilesUnavailable);

    expect(headers.get('Cache-Control')).toBeUndefined();
    expect(headers.has('X-Map-Lat')).toBe(false);
  });
});

// @traces 1196-FR-006
describe('StaticMapAnswers, failures', () => {
  const contextOf = (res: Response) =>
    ({
      switchToHttp: () => ({ getResponse: () => res }),
    }) as unknown as ExecutionContext;

  it('sets no-store before the handler runs', async () => {
    const { res, headers } = response();
    const next: CallHandler = { handle: () => of('ok') };

    await lastValueFrom(new StaticMapAnswers().intercept(contextOf(res), next));

    expect(headers.get('Cache-Control')).toBe('no-store');
  });

  it('turns an unavailable tile provider into a 502 map_tiles_unavailable', async () => {
    const { res } = response();
    const next: CallHandler = {
      handle: () => throwError(() => new MapTilesUnavailable('timeout')),
    };

    const failure = await lastValueFrom(
      new StaticMapAnswers().intercept(contextOf(res), next),
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(HttpException);
    expect((failure as HttpException).getStatus()).toBe(502);
    expect(JSON.stringify((failure as HttpException).getResponse())).toContain(
      'map_tiles_unavailable',
    );
  });

  it('lets a validation refusal pass as a 400 and an unknown error pass as it is', async () => {
    const { res } = response();
    const bad = new BadRequestException('nope');
    const boom = new Error('boom');
    const run = (error: Error) =>
      lastValueFrom(
        new StaticMapAnswers().intercept(contextOf(res), {
          handle: () => throwError(() => error),
        }),
      ).catch((e: unknown) => e);

    expect(await run(bad)).toBe(bad);
    expect(await run(boom)).toBe(boom);
  });
});

// @traces 1196-FR-005
describe('StaticMapController, a blank view', () => {
  it('keeps an image drawn from no tile data out of every cache', async () => {
    const fetch = jest.fn(async (input: string | URL | Request) =>
      String(input).endsWith('/planet')
        ? Response.json({ tiles: ['https://tiles.test/{z}/{x}/{y}.pbf'] })
        : new Response('', { status: 404 }),
    ) as unknown as typeof globalThis.fetch;
    const blank = await new StaticMapRenderer('https://tiles.test/planet', {
      fetch,
    }).render({ h: 320, lat: 44.43, lng: 26.1, theme: 'light', w: 390, z: 13 });
    const { controller, render } = setup();
    render.mockResolvedValue(blank);
    const { res, headers } = response();
    headers.set('Cache-Control', 'no-store');

    await controller.render(query(), { ip: 'b' } as Request, res);

    expect(headers.get('Cache-Control')).toBe('no-store');
  });
});
