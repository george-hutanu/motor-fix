// Plausible's EU service, in manual mode: the app sends each page view
// itself, so it names a page by its route template and never by an address
// that could carry a token.
const SCRIPT = 'https://plausible.io/js/script.manual.js';

type Plausible = ((...args: unknown[]) => void) & { q?: unknown[][] };
const host = () => window as unknown as { plausible?: Plausible };

// Adds the script once, with a queue that holds the calls made before it ran.
export function loadPlausible(domain: string): void {
  if (document.querySelector(`script[src="${SCRIPT}"]`)) return;
  if (!host().plausible) {
    const queued: Plausible = (...args: unknown[]) => {
      queued.q = queued.q ?? [];
      queued.q.push(args);
    };
    host().plausible = queued;
  }
  const script = document.createElement('script');
  script.defer = true;
  script.dataset['domain'] = domain;
  script.src = SCRIPT;
  document.head.append(script);
}

export function pageview(template: string): void {
  host().plausible?.('pageview', { u: `${location.origin}${template}` });
}
