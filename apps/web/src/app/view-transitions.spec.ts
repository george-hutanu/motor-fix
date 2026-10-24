import { ApplicationRef, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  provideRouter,
  Router,
  RouterOutlet,
  withViewTransitions,
} from '@angular/router';
import { REDUCED_MOTION } from '@motor-fix/ui-cockpit';

import { skipStillTransitions } from './view-transitions';

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
describe('the view transitions between screens', () => {
  let started: Started[];
  let router: Router;
  const reduced = signal(false);

  function boot(withApi = true) {
    started = [];
    const doc = document as Document & { startViewTransition?: unknown };
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
          withViewTransitions({
            onViewTransitionCreated: skipStillTransitions,
          }),
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

  it('runs a transition from the results to a garage profile', async () => {
    boot();
    await at('/ro/garages');

    await router.navigateByUrl('/ro/garages/atelier-ion');

    expect(started).toHaveLength(1);
    expect(started[0]?.skipTransition).not.toHaveBeenCalled();
  });

  it('skips the transition when only the query changes', async () => {
    boot();
    await at('/ro/garages?brand=dacia');

    await router.navigateByUrl('/ro/garages?brand=bmw');

    expect(started[0]?.skipTransition).toHaveBeenCalled();
  });

  it('skips the transition when only the fragment changes', async () => {
    boot();
    await at('/ro/garages/atelier-ion');

    await router.navigateByUrl('/ro/garages/atelier-ion#reviews');

    expect(started[0]?.skipTransition).toHaveBeenCalled();
  });

  it('skips the transition when the address is rewritten in place, as the language switch does', async () => {
    boot();
    await at('/ro/garages/atelier-ion');

    await router.navigateByUrl('/en/garages/atelier-ion', { replaceUrl: true });

    expect(started[0]?.skipTransition).toHaveBeenCalled();
  });

  it('skips every transition when the device asks for reduced motion', async () => {
    boot();
    reduced.set(true);
    await at('/ro/garages');

    await router.navigateByUrl('/ro/garages/atelier-ion');

    expect(started[0]?.skipTransition).toHaveBeenCalled();
  });

  it('navigates as before in a browser without view transitions', async () => {
    boot(false);
    await at('/ro/garages');

    const done = await router.navigateByUrl('/ro/garages/atelier-ion');

    expect(done).toBe(true);
    expect(router.url).toBe('/ro/garages/atelier-ion');
  });
});
