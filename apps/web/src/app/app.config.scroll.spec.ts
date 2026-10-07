import { ViewportScroller } from '@angular/common';
import { ApplicationRef, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  provideRouter,
  Router,
  RouterOutlet,
  withInMemoryScrolling,
} from '@angular/router';

import { SCROLLING } from './app.config';

@Component({ template: '' })
class Page {}

// The router starts scrolling when the app boots, as main.ts boots it.
@Component({
  imports: [RouterOutlet],
  selector: 'mf-scroll-root',
  template: '<router-outlet />',
})
class Root {}

function boot() {
  document.body.appendChild(document.createElement('mf-scroll-root'));
  TestBed.inject(ApplicationRef).bootstrap(Root);
  return TestBed.inject(Router);
}

// The router scrolls a tick after the navigation ends.
const scrolled = () => new Promise((resolve) => setTimeout(resolve, 50));

// @traces 028-FR-003
describe('the router scrolling', () => {
  let scroller: { [key: string]: jest.Mock };

  beforeEach(() => {
    scroller = {
      getScrollPosition: jest.fn(() => [0, 640]),
      scrollToAnchor: jest.fn(),
      scrollToPosition: jest.fn(),
      setHistoryScrollRestoration: jest.fn(),
      setOffset: jest.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [
            { component: Page, path: 'app/driver' },
            { component: Page, path: 'app/driver/cars' },
          ],
          withInMemoryScrolling(SCROLLING),
        ),
        { provide: ViewportScroller, useValue: scroller },
      ],
    });
  });

  it('turns on position restoration for the whole router', () => {
    expect(SCROLLING).toEqual({ scrollPositionRestoration: 'enabled' });
  });

  it('starts a forward navigation to another view at the top of the window', async () => {
    const router = boot();
    await router.navigateByUrl('/app/driver');
    await scrolled();
    scroller['scrollToPosition'].mockClear();

    await router.navigateByUrl('/app/driver/cars');
    await scrolled();

    expect(scroller['scrollToPosition']).toHaveBeenCalledWith([0, 0]);
  });

  it('leaves the position alone for a navigation that asks to scroll by hand', async () => {
    const router = boot();
    await router.navigateByUrl('/app/driver');
    await scrolled();
    scroller['scrollToPosition'].mockClear();

    await router.navigate([], {
      queryParams: { draft: 'k' },
      scroll: 'manual',
    });
    await scrolled();

    expect(scroller['scrollToPosition']).not.toHaveBeenCalled();
  });
});
