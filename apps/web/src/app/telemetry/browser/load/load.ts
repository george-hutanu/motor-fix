import { NavigationEnd, NavigationError, type Router } from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';

const idle = () =>
  new Promise<void>((resolve) => {
    if ('requestIdleCallback' in window)
      window.requestIdleCallback(() => resolve());
    else setTimeout(resolve, 1);
  });

// The first navigation has ended: before that the page has no route to be
// named by (a page loaded on demand is still on its way), and every measure
// sent would be filed as unmatched. A failed one ends the wait as well, so
// its error is still reported.
const navigated = (router: Router) =>
  router.navigated
    ? Promise.resolve()
    : firstValueFrom(
        router.events.pipe(
          filter(
            (event) =>
              event instanceof NavigationEnd ||
              event instanceof NavigationError,
          ),
        ),
      );

// Loads browser telemetry only on a page the server marked for it with an
// http(s) collector, once the first navigation has ended and the page is
// idle, as its own chunk so the first load does not carry it.
export async function loadTelemetry(
  router: Router,
  doc: Document = document,
): Promise<void> {
  const tag = doc.querySelector<HTMLMetaElement>('meta[name="mf-telemetry"]');
  if (!tag || !/^https?:\/\//.test(tag.content)) return;
  try {
    await navigated(router);
    await idle();
    const { startFaro } = await import('../faro');
    startFaro({
      router,
      url: tag.content,
      version: tag.dataset['version'] || 'dev',
    });
  } catch {
    // Telemetry is optional: a blocked chunk or a failed start leaves the page
    // as it is.
  }
}
