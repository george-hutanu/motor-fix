# How each launch figure is measured

Every "How to measure it" figure of the launch features, and where its number
comes from: an analytics event sent to Plausible (only after the visitor
accepted analytics cookies), a database count (no consent needed, nothing
personal), or nothing yet. `apps/web/src/app/consent/analytics-measurement.spec.ts`
keeps this list in step with the event table in
`apps/web/src/app/consent/analytics-events.ts`.

## Launch features

| Feature | Figure | How it is measured | Surface built? | Note |
| --- | --- | --- | --- | --- |
| Home | Share of visitors who choose a brand | `brand_picked` (`source: home_picker`) over the Home page views | yes | The brand strip and the results chips will send `home_strip` and `results_chips` when they exist |
| Home | Share who continue to Results or a garage profile | `garage_opened` (`source: home`) and the Results page views | yes | Page views are named by route template, never the address |
| Home | Garage sign-ups started from the bottom section | not measured at launch | yes | `listing_started` carries no source |
| Sign-in | Share of visitors who create an account when asked | `sign_up_completed`; the share needs the dialog's openings, which are not sent | yes | Not measured at launch as a share |
| Sign-in | Sign-up method split: e-mail, Apple, Google, phone | `sign_up_completed` (`method`) | yes | `role` is always `driver` until garage sign-up exists |
| Quote request and booking | Requests per day | database count: requests sent, overview with period "today"; also `quote_request_sent` | yes | The count is the truth; the event only covers consenting visitors |
| Quote request and booking | Median time to the first quote | not measured at launch | yes | Would need a new count over `quote.sent_at` minus `quote_request.created_at` |
| Quote request and booking | Share of requests that get a quote | database count: nightly `requests_quoted` over requests sent | yes | |
| Quote request and booking | Share of quotes accepted | database count: nightly `requests_accepted`; `quote_accepted` once the web has an accept screen | no | The API has the accept; the web screen does not |
| Quote request and booking | Share of bookings that become a finished job | database count: nightly `jobs_done` over `bookings_confirmed` | yes | |
| List your garage | Share of started forms that are submitted | `listing_started` and `listing_submitted` (the garage funnel) | yes | `listing_submitted` fires when the form's send reaches complete; it moves to the verification submit when that ships |
| List your garage | The step where most forms are abandoned | `listing_step_completed` (`step`) | yes | |
| List your garage | Median time to complete the form | not measured at launch | yes | |
| Admin dashboard | Requests per active driver | not measured at launch | yes | Both counts are on the overview; their ratio is not shown |
| Admin dashboard | Share of requests answered within an hour | not measured at launch | yes | The answer rate counts 24 hours |
| Admin dashboard | Share of requests that become jobs | database count: nightly `jobs_done` over requests sent | yes | Across days, so an approximation |
| Admin dashboard | Garages live | database count: garages live | yes | |
| Admin dashboard | Requests sent | database count: requests sent | yes | |
| Admin dashboard | Answer rate | database count: answer rate | yes | |
| Admin dashboard | Bookings | database count: bookings | yes | |
| Other launch features | Not read at planning | not measured at launch | — | Owner to fill from each feature's "How to measure it" |

## Events

One Plausible custom event per name; each carries only the properties listed
in `analytics-events.ts`, and its page is the route template.

| Event | Surface | Built |
| --- | --- | --- |
| `sign_up_completed` | E-mail sign-up, Google or Apple first sign-in, phone sign-up | built |
| `brand_picked` | Home: a brand picker tile or a brand search result | built |
| `garage_opened` | The garage profile, once per open, with where it was opened from | built |
| `filter_applied` | Results filters | not built |
| `garage_saved` | Saving a garage from its profile or a result card | not built |
| `quote_request_started` | "Cere ofertă" on the garage profile | built |
| `quote_request_sent` | The quote request created, once per send | built |
| `message_sent` | Messages between a driver and a garage | not built |
| `request_answered` | The garage sends a quote or declines a request | built |
| `quote_accepted` | The driver accepts a quote in the web | not built |
| `review_posted` | A driver posts a review | not built |
| `listing_started` | List your garage: the draft's first server copy | built |
| `listing_step_completed` | List your garage: a step newly completed | built |
| `survey_completed` | List your garage: the closing survey | not built |
| `listing_submitted` | List your garage: the send reaching complete | built |

## Database counts

The admin overview counts these live for the chosen period and city; the
night job (01:00 Europe/Bucharest) writes the funnel counts of the day before
on that day's whole-country `platform_daily` row.

| Figure | Source | Definition |
| --- | --- | --- |
| Garages live | Admin overview | Garages approved now; drafts and suspended garages are left out |
| Requests sent | Admin overview | Quote requests created in the period (the current Bucharest month by default); a request to several garages counts once; in a city, requests with at least one recipient garage there |
| Answer rate | Admin overview | Share of garage recipients of the last 30 days that quoted or declined within 24 hours, all hours, rounded down; a closed recipient and one still waiting under a day are left out; none when no recipient counted; the 30 days do not follow the period |
| Bookings | Admin overview | Bookings confirmed in the period; in a city, bookings at a garage there |
| `requests_quoted` | Night job | Quote requests whose first quote was sent that Bucharest day, each request once |
| `requests_accepted` | Night job | Quote requests with a quote accepted that Bucharest day, each request once |
| `bookings_confirmed` | Night job | Bookings confirmed that Bucharest day, whatever happened to them after |
| `jobs_done` | Night job | Jobs that reached done that Bucharest day |
| `reviews_posted` | Night job | Reviews posted that Bucharest day; 0 until reviews exist |

## Plausible setup

Done by the owner in Plausible's dashboard; nothing in the code sets it up.

- One goal per event in the table above.
- Driver funnel: Home → `brand_picked` → `garage_opened` → `quote_request_started` → `quote_request_sent` → `quote_accepted` → `review_posted`.
- Garage funnel: `listing_started` → `listing_step_completed` step 6 → `survey_completed` → `listing_submitted`.

## Manual check

- [ ] After the pilot, compare the overview's figures with direct database counts, and the Plausible funnels with the nightly funnel counts.
