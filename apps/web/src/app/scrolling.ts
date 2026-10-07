import { ViewportScroller } from '@angular/common';
import { inject, provideEnvironmentInitializer } from '@angular/core';
import { NavigationStart, Router, Scroll } from '@angular/router';

// A new screen opens at the top. A navigation that keeps the screen (only the
// query or the fragment changes: an overlay, a wizard step) or rewrites its
// address in place (the language) leaves the page where it is, and so does the
// back button, whose position the browser restores. A navigation that must not
// move the page also says scroll: 'manual'. Needs withInMemoryScrolling().
export function provideViewScrolling() {
  return provideEnvironmentInitializer(() => {
    const router = inject(Router);
    const scroller = inject(ViewportScroller);
    let path: string | undefined;
    let keep = false;
    const started = (event: NavigationStart) =>
      event.navigationTrigger === 'popstate' ||
      router.currentNavigation()?.extras.replaceUrl === true;
    const scrolled = (event: Scroll) => {
      const next = router.url.split(/[?#]/)[0];
      const moved = path !== undefined && next !== path;
      path = next;
      if (moved && !keep && event.scrollBehavior !== 'manual')
        scroller.scrollToPosition([0, 0]);
    };
    router.events.subscribe((event) => {
      if (event instanceof NavigationStart) keep = started(event);
      if (event instanceof Scroll) scrolled(event);
    });
  });
}
