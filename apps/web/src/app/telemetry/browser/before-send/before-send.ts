import { type TransportItem, TransportItemType } from '@grafana/faro-web-sdk';
import { scrub } from '@motor-fix/observability/scrub';

export type Viewport = 'phone' | 'tablet' | 'desktop';

const MAX_ERRORS = 20;
// A URL's query and fragment can carry a token, a search or an e-mail.
const URL_TAIL = /(https?:\/\/[^\s?#"'<>]*)[?#][^\s"'<>]*/g;

export function viewportClass(width: number): Viewport {
  if (width < 768) return 'phone';
  return width < 1200 ? 'tablet' : 'desktop';
}

function clean(value: unknown): unknown {
  if (typeof value === 'string') return scrub(value.replace(URL_TAIL, '$1'));
  if (Array.isArray(value)) return value.map(clean);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [key, clean(inner)]),
  );
}

// Runs on every item before it leaves the browser: personal values masked,
// URLs cut to their path, no session or user, the viewport class on each
// measurement, and at most twenty errors per page load.
export function createBeforeSend(viewport: Viewport) {
  let errors = 0;
  return (item: TransportItem): TransportItem | null => {
    if (item.type === TransportItemType.EXCEPTION && ++errors > MAX_ERRORS)
      return null;
    const sent = clean(item) as TransportItem;
    delete sent.meta.session;
    delete sent.meta.user;
    if (sent.type === TransportItemType.MEASUREMENT) {
      const payload = sent.payload as { context?: Record<string, unknown> };
      payload.context = { ...payload.context, viewport };
    }
    return sent;
  };
}
