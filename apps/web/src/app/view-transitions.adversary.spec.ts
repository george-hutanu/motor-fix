import { ApplicationRef, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import { REDUCED_MOTION } from '@motor-fix/ui-cockpit';

import { screenTransitions } from './view-transitions';

@Component({ template: '' })
class Page {}

@Component({
  imports: [RouterOutlet],
  selector: 'mf-transition-root',
  template: '<router-outlet />',
})
class Root {}

type Started = { skipTransition: jest.Mock };

// @traces 1193-FR-004
describe('the view transitions under hostile navigation', () => {
  let started: Started[];
  let router: Router;
  const reduced = signal(false);

  function boot(withApi = true) {
    started = [];
    const doc = document as { startViewTransition?: unknown };
    doc.startViewTransition = withApi
      ? jest.fn((update: () => Promise<void>) => {
          const done = Promise.resolve().then(update);
          const transition = {
            finished: done,
            ready: done,
            skipTransition: jest.fn(),
            updateCallbackDone: done,
          };
          started.push(transition);
          return transition;
        })
      : undefined;
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [
            { component: Page, path: 'ro/garages' },
            { component: Page, path: 'ro/garages/:garage' },
            { component: Page, path: 'en/garages/:garage' },
          ],
          screenTransitions(),
        ),
        { provide: REDUCED_MOTION, useValue: reduced.asReadonly() },
      ],
    });
    document.body.appendChild(document.createElement('mf-transition-root'));
    TestBed.inject(ApplicationRef).bootstrap(Root);
    router = TestBed.inject(Router);
  }

  async function at(url: string) {
    await router.navigateByUrl(url);
    started.length = 0;
  }

  afterEach(() => {
    Reflect.deleteProperty(document, 'startViewTransition');
    document.querySelector('mf-transition-root')?.remove();
    reduced.set(false);
  });

  it('runs a transition from one garage profile to another', async () => {
    boot();
    await at('/ro/garages/atelier-ion');

    await router.navigateByUrl('/ro/garages/service-vlad');

    expect(started).toHaveLength(1);
    expect(started[0]?.skipTransition).not.toHaveBeenCalled();
  });

  it('runs transitions again once reduced motion is switched off', async () => {
    boot();
    reduced.set(true);
    await at('/ro/garages');
    await router.navigateByUrl('/ro/garages/atelier-ion');
    expect(started[0]?.skipTransition).toHaveBeenCalled();

    reduced.set(false);
    started.length = 0;
    await router.navigateByUrl('/ro/garages');

    expect(started).toHaveLength(1);
    expect(started[0]?.skipTransition).not.toHaveBeenCalled();
  });

  it('skips the transition when only a matrix parameter changes', async () => {
    boot();
    await at('/ro/garages');

    await router.navigateByUrl('/ro/garages;tab=map');

    expect(started[0]?.skipTransition).toHaveBeenCalled();
  });

  it('skips the transition when a second query parameter is added', async () => {
    boot();
    await at('/ro/garages?brand=dacia');

    await router.navigateByUrl('/ro/garages?brand=dacia&page=2');

    expect(started[0]?.skipTransition).toHaveBeenCalled();
  });

  it('skips a transition for a reduced-motion device on a same-path navigation exactly once', async () => {
    boot();
    reduced.set(true);
    await at('/ro/garages?a=1');

    await router.navigateByUrl('/ro/garages?a=2');

    expect(started[0]?.skipTransition).toHaveBeenCalledTimes(1);
  });
});
