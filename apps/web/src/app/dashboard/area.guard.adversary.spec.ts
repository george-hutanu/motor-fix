import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { MeDto } from '@motor-fix/data-access';

import { areaGuard } from './area.guard';
import { Session } from './session';

@Component({ template: '' })
class Page {}

const who = (landing: string) => ({ landing }) as unknown as MeDto;

async function visit(address: string, me: MeDto | null, area = 'driver') {
  const keepReturnTo = jest.fn();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        {
          canMatch: [areaGuard(area as 'driver')],
          children: [{ component: Page, path: '**' }],
          path: `app/${area}`,
        },
        { component: Page, path: '**' },
      ]),
      { provide: Session, useValue: { keepReturnTo, load: async () => me } },
    ],
  });
  const router = TestBed.inject(Router);
  await router.navigateByUrl(address);
  return { keepReturnTo, router };
}

describe('the area guard for a visitor', () => {
  it('keeps nothing for a signed-in driver', async () => {
    const { keepReturnTo, router } = await visit(
      '/app/driver/cars',
      who('/app/driver'),
    );

    expect(keepReturnTo).not.toHaveBeenCalled();
    expect(router.url).toBe('/app/driver/cars');
  });

  it('keeps nothing for a signed-in garage account sent to its own landing', async () => {
    const { keepReturnTo, router } = await visit(
      '/app/driver/cars',
      who('/app/garage'),
    );

    expect(keepReturnTo).not.toHaveBeenCalled();
    expect(router.url).toBe('/app/garage');
  });

  it('keeps the bare dashboard address', async () => {
    const { keepReturnTo } = await visit('/app/driver', null);

    expect(keepReturnTo).toHaveBeenCalledWith('/app/driver');
  });

  it('keeps a deep address with an encoded query and a fragment', async () => {
    const { keepReturnTo } = await visit(
      '/app/driver/cars/a/b?name=%C8%99tefan&x=1&x=2#top',
      null,
    );

    expect(keepReturnTo).toHaveBeenCalledTimes(1);
    expect(keepReturnTo).toHaveBeenCalledWith(
      '/app/driver/cars/a/b?name=%C8%99tefan&x=1&x=2#top',
    );
  });

  it('keeps an address that starts with a slash and never a double one', async () => {
    const { keepReturnTo } = await visit('/app/driver//cars', null);

    const kept = keepReturnTo.mock.calls[0]?.[0] as string;
    expect(kept.startsWith('/')).toBe(true);
    expect(kept.startsWith('//')).toBe(false);
  });

  it('sends the visitor home in the language in use and not to the asked address', async () => {
    const { router } = await visit('/app/driver/cars', null);

    expect(router.url).toBe('/ro');
  });

  it('keeps the address of each visit, the latest last', async () => {
    const { keepReturnTo, router } = await visit('/app/driver/cars', null);
    await router.navigateByUrl('/app/driver/saved');

    expect(keepReturnTo.mock.calls.map((c) => c[0])).toEqual([
      '/app/driver/cars',
      '/app/driver/saved',
    ]);
  });
});
