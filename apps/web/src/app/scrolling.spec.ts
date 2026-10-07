import { Location, ViewportScroller } from '@angular/common';
import { ApplicationRef, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  provideRouter,
  Router,
  RouterOutlet,
  withInMemoryScrolling,
} from '@angular/router';

import { provideViewScrolling } from './scrolling';

@Component({ template: '' })
class Page {}

// The router starts scrolling when the app boots, as main.ts boots it.
@Component({
  imports: [RouterOutlet],
  selector: 'mf-scroll-root',
  template: '<router-outlet />',
})
class Root {}

// The router scrolls a tick after the navigation ends.
const scrolled = () => new Promise((resolve) => setTimeout(resolve, 50));

// @traces 028-FR-003
describe('the router scrolling', () => {
  let scroller: { [key: string]: jest.Mock };
  let router: Router;

  beforeEach(async () => {
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
            { component: Page, path: 'en/app/driver/cars' },
          ],
          withInMemoryScrolling(),
        ),
        provideViewScrolling(),
        { provide: ViewportScroller, useValue: scroller },
      ],
    });
    document.body.appendChild(document.createElement('mf-scroll-root'));
    TestBed.inject(ApplicationRef).bootstrap(Root);
    router = TestBed.inject(Router);
    await router.navigateByUrl('/app/driver');
    await scrolled();
    scroller['scrollToPosition'].mockClear();
  });

  it('starts a forward navigation to another view at the top of the window', async () => {
    await router.navigateByUrl('/app/driver/cars');
    await scrolled();

    expect(scroller['scrollToPosition']).toHaveBeenCalledWith([0, 0]);
  });

  it('leaves the page where it is when only the query changes', async () => {
    await router.navigate([], { queryParams: { dialog: 'sign-in' } });
    await scrolled();

    expect(scroller['scrollToPosition']).not.toHaveBeenCalled();
  });

  it('leaves the page where it is when only the fragment changes', async () => {
    await router.navigate([], { fragment: 'mechanics' });
    await scrolled();

    expect(scroller['scrollToPosition']).not.toHaveBeenCalled();
  });

  it('leaves the page where it is when the address is rewritten in place', async () => {
    await router.navigateByUrl('/en/app/driver/cars', { replaceUrl: true });
    await scrolled();

    expect(scroller['scrollToPosition']).not.toHaveBeenCalled();
  });

  it('leaves the page where it is for a navigation that asks to scroll by hand', async () => {
    await router.navigateByUrl('/app/driver/cars', { scroll: 'manual' });
    await scrolled();

    expect(scroller['scrollToPosition']).not.toHaveBeenCalled();
  });

  it('leaves the back button to the browser, which returns to where the person was', async () => {
    await router.navigateByUrl('/app/driver/cars');
    await scrolled();
    scroller['scrollToPosition'].mockClear();

    TestBed.inject(Location).back();
    await scrolled();

    expect(router.url).toBe('/app/driver');
    expect(scroller['scrollToPosition']).not.toHaveBeenCalled();
  });
});
