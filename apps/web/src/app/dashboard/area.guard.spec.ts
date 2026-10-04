import { TestBed } from '@angular/core/testing';
import {
  type PartialMatchRouteSnapshot,
  type Route,
  Router,
  type UrlSegment,
  type UrlTree,
} from '@angular/router';
import type { MeDto } from '@motor-fix/data-access';

import { areaGuard } from './area.guard';
import { Session } from './session';
import { routes } from '../app.routes';

function me(landing: string): MeDto {
  return {
    capabilities: [],
    email: null,
    garageId: null,
    id: 'account-1',
    landing,
    language: 'ro',
    name: 'Andrei',
    role: 'driver',
    roles: ['driver'],
  } as unknown as MeDto;
}

function run(area: 'driver' | 'garage' | 'admin', who: MeDto | null) {
  TestBed.configureTestingModule({
    providers: [{ provide: Session, useValue: { load: async () => who } }],
  });
  return TestBed.runInInjectionContext(() =>
    areaGuard(area)(
      {} as Route,
      [] as UrlSegment[],
      {} as PartialMatchRouteSnapshot,
    ),
  ) as Promise<boolean | UrlTree>;
}

const path = (result: boolean | UrlTree) =>
  result === true
    ? true
    : TestBed.inject(Router).serializeUrl(result as UrlTree);

describe('areaGuard', () => {
  it('opens the area the person lands on', async () => {
    expect(path(await run('driver', me('/app/driver')))).toBe(true);
  });

  it.each([
    'garage',
    'admin',
  ] as const)('sends a driver who types /app/%s to /app/driver', async (area) => {
    expect(path(await run(area, me('/app/driver')))).toBe('/app/driver');
  });

  it('sends a mechanic who types /app/admin to /app/garage', async () => {
    expect(path(await run('admin', me('/app/garage')))).toBe('/app/garage');
  });

  it('sends a signed-out visitor home', async () => {
    expect(path(await run('garage', null))).toBe('/');
  });
});

describe('dashboard routes', () => {
  it.each([
    'driver',
    'garage',
    'admin',
  ])('guard app/%s before its code downloads', (area) => {
    const route = routes.find((r) => r.path === `app/${area}`);

    expect(route?.canMatch).toHaveLength(1);
    expect(route?.loadComponent).toBeDefined();
    expect(route?.component).toBeUndefined();
  });
});
