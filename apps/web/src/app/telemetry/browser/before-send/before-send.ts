import {
  EVENT_SESSION_EXTEND,
  EVENT_SESSION_RESUME,
  EVENT_SESSION_START,
  EVENT_VIEW_CHANGED,
  type TransportItem,
  TransportItemType,
} from '@grafana/faro-web-sdk';
import { scrub, scrubDeep } from '@motor-fix/observability/scrub';

type Viewport = 'phone' | 'tablet' | 'desktop';

interface Spans {
  resourceSpans?: {
    resource?: { attributes?: { key: string }[] };
    scopeSpans?: { spans?: { attributes?: { key: string }[] }[] }[];
  }[];
}

const MAX_ERRORS = 20;
// A URL's query and fragment can carry a token, a search or an e-mail.
const URL_TAIL = /(https?:\/\/[^\s?#"'<>]*)[?#][^\s"'<>]*/g;
// The events that make a session and its journey: sent under consent only.
const JOURNEY: ReadonlySet<string> = new Set([
  EVENT_SESSION_EXTEND,
  EVENT_SESSION_RESUME,
  EVENT_SESSION_START,
  EVENT_VIEW_CHANGED,
]);

export function viewportClass(width: number): Viewport {
  if (width < 768) return 'phone';
  return width < 1200 ? 'tablet' : 'desktop';
}

const clean = (text: string) => scrub(text.replace(URL_TAIL, '$1'));

const isJourney = (item: TransportItem) =>
  item.type === TransportItemType.EVENT &&
  JOURNEY.has((item.payload as { name?: string }).name ?? '');

// Without consent no session: not in the meta, and not in the spans, where
// the tracing instrumentation copies its id.
const notSession = (attribute: { key: string }) =>
  attribute.key !== 'session.id';

function dropSession(sent: TransportItem) {
  delete sent.meta.session;
  if (sent.type !== TransportItemType.TRACE) return;
  for (const resource of (sent.payload as Spans).resourceSpans ?? []) {
    if (resource.resource?.attributes)
      resource.resource.attributes =
        resource.resource.attributes.filter(notSession);
    const spans = (resource.scopeSpans ?? []).flatMap((s) => s.spans ?? []);
    for (const span of spans)
      span.attributes = span.attributes?.filter(notSession);
  }
}

// Runs on every item before it leaves the browser: personal values masked,
// URLs cut to their path, no user or user-agent, the viewport class on each
// measurement, and at most twenty errors per page load. The session and the
// journey events go only while analytics consent holds, read per item.
export function createBeforeSend(viewport: Viewport, granted: () => boolean) {
  let errors = 0;
  return (item: TransportItem): TransportItem | null => {
    if (item.type === TransportItemType.EXCEPTION && ++errors > MAX_ERRORS)
      return null;
    const consented = granted();
    if (!consented && isJourney(item)) return null;
    const sent = scrubDeep(item, clean);
    if (!consented) dropSession(sent);
    delete sent.meta.user;
    // The privacy notice says the browser description never reaches
    // monitoring; its name, version and system are enough to triage.
    delete sent.meta.browser?.userAgent;
    delete sent.meta.browser?.brands;
    if (sent.type === TransportItemType.MEASUREMENT) {
      const payload = sent.payload as { context?: Record<string, unknown> };
      payload.context = { ...payload.context, viewport };
    }
    return sent;
  };
}
