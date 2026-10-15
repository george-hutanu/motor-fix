type Rule = readonly string[] | 'slug' | 'count' | 'step' | 'rating';

// The launch events and the only properties each may carry. Plausible keeps
// what it is sent, so anything else is dropped before it leaves.
export const ANALYTICS_EVENTS = {
  brand_picked: {
    brand: 'slug',
    source: ['home_picker', 'home_strip', 'results_chips'],
  },
  filter_applied: {
    filter: ['open_now', 'open_saturday', 'max_price', 'min_rating', 'card'],
  },
  garage_opened: {
    source: ['results', 'map_pin', 'home', 'shared_link', 'saved_list'],
  },
  garage_saved: { source: ['profile', 'result_card'] },
  listing_started: {},
  listing_step_completed: { step: 'step' },
  listing_submitted: {},
  message_sent: { side: ['driver', 'garage'] },
  quote_accepted: {
    position: 'count',
    sort: ['fastest', 'price', 'slot', 'rating'],
  },
  quote_request_sent: {
    brand: 'slug',
    garages: ['1', '2–3', '4–5'],
    jobs: 'count',
  },
  quote_request_started: { source: ['profile', 'results'] },
  request_answered: { action: ['quote', 'decline'] },
  review_posted: { has_text: ['yes', 'no'], rating: 'rating' },
  sign_up_completed: {
    method: ['email', 'google', 'apple', 'phone'],
    role: ['driver', 'garage'],
  },
  survey_completed: {},
} as const satisfies Record<string, Record<string, Rule>>;

export type AnalyticsEvent = keyof typeof ANALYTICS_EVENTS;
export type EventProps = Record<string, string | number>;

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const RANGES = {
  count: [1, Number.MAX_SAFE_INTEGER],
  rating: [1, 5],
  step: [1, 6],
} as const;

function allowed(rule: Rule, value: unknown): value is string | number {
  if (typeof rule !== 'string') return rule.includes(value as string);
  if (rule === 'slug')
    return typeof value === 'string' && value.length <= 80 && SLUG.test(value);
  const [min, max] = RANGES[rule];
  return (
    Number.isInteger(value) &&
    (value as number) >= min &&
    (value as number) <= max
  );
}

// The properties the event may carry, or null for a name outside the list.
export function sanitise(
  name: string,
  props: Record<string, unknown> | null | undefined,
): EventProps | null {
  if (!Object.hasOwn(ANALYTICS_EVENTS, name)) return null;
  if (props === null || typeof props !== 'object') return {};
  const rules: Record<string, Rule> = ANALYTICS_EVENTS[name as AnalyticsEvent];
  const kept: EventProps = {};
  for (const [key, value] of Object.entries(props))
    if (Object.hasOwn(rules, key) && allowed(rules[key] as Rule, value))
      kept[key] = value;
  return kept;
}
