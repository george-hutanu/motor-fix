import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  type PartialMatchRouteSnapshot,
  provideRouter,
  RedirectCommand,
  type Route,
  Router,
  type UrlSegment,
  type UrlTree,
} from '@angular/router';
import type { MeDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { areaGuard } from './area.guard';
import { Session } from './session';
import { routes } from '../app.routes';

function me(landing: string): MeDto {
  return {
    capabilities: [],
    email: null,
    garageAccess: [],
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
    providers: [
      {
        provide: Session,
        useValue: { keepReturnTo: jest.fn(), load: async () => who },
      },
    ],
  });
  return TestBed.runInInjectionContext(() =>
    areaGuard(area)(
      {} as Route,
      [] as UrlSegment[],
      {} as PartialMatchRouteSnapshot,
    ),
  ) as Promise<boolean | UrlTree | RedirectCommand>;
}

const path = (result: boolean | UrlTree | RedirectCommand) =>
  result === true
    ? true
    : TestBed.inject(Router).serializeUrl(
        result instanceof RedirectCommand
          ? result.redirectTo
          : (result as UrlTree),
      );

describe('areaGuard', () => {
  it('opens the area the person lands on', async () => {
    expect(path(await run('driver', me('/app/driver')))).toBe(true);
  });

  it.each(['garage', 'admin'] as const)(
    'sends a driver who types /app/%s to /app/driver',
    async (area) => {
      expect(path(await run(area, me('/app/driver')))).toBe('/app/driver');
    },
  );

  it('sends a mechanic who types /app/admin to /app/garage', async () => {
    expect(path(await run('admin', me('/app/garage')))).toBe('/app/garage');
  });

  it('sends a signed-out visitor home with the sign-in dialog to open', async () => {
    const result = await run('garage', null);

    expect(result).toBeInstanceOf(RedirectCommand);
    expect(path(result)).toBe('/ro');
    expect(
      (result as RedirectCommand).navigationBehaviorOptions?.state,
    ).toEqual({ signIn: true });
  });

  it('sends them to Home in the language in use', async () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Session,
          useValue: { keepReturnTo: jest.fn(), load: async () => null },
        },
      ],
    });
    await TestBed.inject(I18n).use('en');

    const result = await TestBed.runInInjectionContext(() =>
      areaGuard('admin')(
        {} as Route,
        [] as UrlSegment[],
        {} as PartialMatchRouteSnapshot,
      ),
    );

    expect(path(result as RedirectCommand)).toBe('/en');
  });
});

@Component({ template: '' })
class Page {}

async function visit(address: string, who: MeDto | null) {
  const keepReturnTo = jest.fn();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        {
          canMatch: [areaGuard('driver')],
          children: [{ component: Page, path: '**' }],
          path: 'app/driver',
        },
        { component: Page, path: '**' },
      ]),
      { provide: Session, useValue: { keepReturnTo, load: async () => who } },
    ],
  });
  const router = TestBed.inject(Router);
  await router.navigateByUrl(address);
  return { keepReturnTo, router };
}

// @traces 028-FR-005
describe('the address a visitor asked for', () => {
  it('is kept whole, with its query and fragment, as the visitor goes home', async () => {
    const { keepReturnTo, router } = await visit(
      '/app/driver/cars?x=1#y',
      null,
    );

    expect(keepReturnTo).toHaveBeenCalledTimes(1);
    expect(keepReturnTo).toHaveBeenCalledWith('/app/driver/cars?x=1#y');
    expect(router.url).toBe('/ro');
  });

  it('is not kept for someone signed in', async () => {
    const { keepReturnTo, router } = await visit(
      '/app/driver/cars',
      me('/app/driver'),
    );

    expect(keepReturnTo).not.toHaveBeenCalled();
    expect(router.url).toBe('/app/driver/cars');
  });
});

describe('dashboard routes', () => {
  it.each(['driver', 'garage', 'admin'])(
    'guard app/%s before its code downloads',
    (area) => {
      const route = routes.find((r) => r.path === `app/${area}`);

      expect(route?.canMatch).toHaveLength(1);
      expect(route?.loadComponent).toBeDefined();
      expect(route?.component).toBeUndefined();
    },
  );

  it.each(['driver', 'garage', 'admin'])(
    'loads the views of app/%s on demand, out of the first download',
    async (area) => {
      const route = routes.find((r) => r.path === `app/${area}`);

      expect(route?.children).toBeUndefined();
      const load = route?.loadChildren as () => Promise<Route[]>;
      const children = await load();
      expect(children.length).toBeGreaterThan(0);
    },
  );
});
