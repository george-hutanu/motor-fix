import type { Router } from '@angular/router';

const idle = () =>
  new Promise<void>((resolve) => {
    if ('requestIdleCallback' in window)
      window.requestIdleCallback(() => resolve());
    else setTimeout(resolve, 1);
  });

// Loads browser telemetry only on a page the server marked for it with an
// http(s) collector, once the page is idle, as its own chunk so the first
// load does not carry it.
export async function loadTelemetry(
  router: Router,
  doc: Document = document,
): Promise<void> {
  const tag = doc.querySelector<HTMLMetaElement>('meta[name="mf-telemetry"]');
  if (!tag || !/^https?:\/\//.test(tag.content)) return;
  try {
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
