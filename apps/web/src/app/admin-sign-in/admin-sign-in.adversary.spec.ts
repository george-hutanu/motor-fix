import { Component, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RenderMode } from '@angular/ssr';

import { AdminSignIn } from './admin-sign-in';
import { routes } from '../app.routes';
import { serverRoutes } from '../app.routes.server';
import { SignInDialog } from '../sign-in/sign-in-dialog';

@Component({ selector: 'mf-home', template: '<h1>Home</h1>' })
class HomeStub {}

function render(start: () => Promise<unknown>, platform = 'browser') {
  TestBed.configureTestingModule({
    providers: [
      { provide: SignInDialog, useValue: { start } },
      { provide: PLATFORM_ID, useValue: platform },
    ],
  });
  TestBed.overrideComponent(AdminSignIn, { set: { imports: [HomeStub] } });
  const fixture = TestBed.createComponent(AdminSignIn);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

afterEach(() => TestBed.resetTestingModule());

describe('AdminSignIn under odd conditions', () => {
  it('keeps the home page when the dialog fails to open', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);

    const element = render(() => Promise.reject(new Error('no dialog')));
    await new Promise((resolve) => setTimeout(resolve));
    process.off('unhandledRejection', unhandled);

    expect(element.querySelector('mf-home')).not.toBeNull();
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('opens the dialog once per visit, not on every change detection', () => {
    const start = jest.fn(async () => undefined);
    TestBed.configureTestingModule({
      providers: [
        { provide: SignInDialog, useValue: { start } },
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    });
    TestBed.overrideComponent(AdminSignIn, { set: { imports: [HomeStub] } });
    const fixture = TestBed.createComponent(AdminSignIn);

    fixture.detectChanges();
    fixture.detectChanges();
    fixture.detectChanges();

    expect(start).toHaveBeenCalledTimes(1);
  });
});

describe('the admin route', () => {
  const admin = routes.filter((route) => route.path === 'admin');

  it('is declared once, with no language prefix', () => {
    expect(admin).toHaveLength(1);
  });

  it('answers only the bare address, not an address below it', () => {
    expect(admin[0]?.children?.map((child) => child.path)).toEqual(['']);
  });

  it('is not behind a role or session guard', () => {
    expect(admin[0]?.canActivate ?? []).toHaveLength(0);
    expect(admin[0]?.canMatch).toHaveLength(1);
  });

  it('comes before the catch-all so it is not taken for a missing page', () => {
    const index = routes.findIndex((route) => route.path === 'admin');
    const catchAll = routes.findIndex((route) => route.path === '**');

    expect(index).toBeGreaterThanOrEqual(0);
    if (catchAll >= 0) expect(index).toBeLessThan(catchAll);
  });

  it('is server-rendered like the other public addresses', () => {
    const match = serverRoutes.find((route) => route.path === 'admin');
    const fallback = serverRoutes.find((route) => route.path === '**');

    expect(match?.renderMode ?? fallback?.renderMode).toBe(RenderMode.Server);
  });
});
