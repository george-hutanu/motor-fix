# Observability

Telemetry goes to **Grafana Cloud's free tier** (EU region) over OTLP/HTTP.
Nothing for it runs on Railway: no collector, no Prometheus, Loki, Tempo or
Grafana service, no volume.

## Configuration

Three optional variables, read by `telemetry()` in `libs/contracts/src/env.ts`:

| Variable | Staging and production | Local |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `https://otlp-gateway-prod-eu-west-2.grafana.net/otlp` | `http://localhost:4318` |
| `OTEL_EXPORTER_OTLP_HEADERS` | `Authorization=Basic%20<token>`, percent-encoded as the OTLP spec asks | unset |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` (the default) | unset |

The stack is in Grafana Cloud's prod-eu-west-2 region; its gateway takes
OTLP over HTTP only. `telemetry()` passes
the headers through untouched: the exporter decodes them, as the OTLP
exporter spec says.

Unset endpoint means telemetry off: the apps run unchanged. The owner sets
the values on api, worker and web in staging and production in Railway;
telemetry starts with the first deploy that carries the instrumentation. The
values are never committed, read or printed
by the repo or its agents. Every signal carries `env` (from `APP_ENV`), so staging and production share one
stack and stay apart in every query. Export is fire-and-forget: an app never
waits on, or fails because of, telemetry.

Locally, `docker compose --profile observability up -d otel-lgtm` runs
`grafana/otel-lgtm`: Grafana on `${GRAFANA_PORT:-3300}` (clear of the api's
3000), OTLP on 4317 and 4318. Without the profile compose starts what it always has.

Two start-up warnings name a variable that leaves a dashboard empty; each is
one `warn` JSON line and one OTel WARN record, so it shows in Loki:

| Warning | Logged by | Set |
|---|---|---|
| `datastore metrics: MONITOR_DATABASE_URL unset, PostgreSQL readings off` | the worker, its only reader | `MONITOR_DATABASE_URL` (the monitoring role) on the worker |
| `browser telemetry off: FARO_URL unset` | the web server, only while its own telemetry is on | `FARO_URL` on the web |

## The web app and the browser

The web server is a service like the others (`service.name` `web`): request
spans named by route template (`GET /:lang/garages/:garage`, `GET /api` for
the pass-through to the API, `client-rendered` for a page left to the
browser, `unmatched` for a failed render or no route), request duration and
runtime metrics, and one masked JSON line plus an OTLP log record per render
error. Static files and `/health/*` are not traced. `/health/ready` is ready
only while the API's is.

The browser sends to Grafana Faro, only when the server is given
`FARO_URL` (the Faro collector URL with its app key; unset sends nothing):
the server puts it in a `<meta name="mf-telemetry">` tag with the release,
and the page loads the SDK once idle, as its own chunk. It sends errors (at
most twenty per page load), Web Vitals labelled by route template and
viewport class (phone, tablet, desktop), and traces of same-origin `/api`
calls, which carry `traceparent` to the web server. No session id, no user,
nothing stored on the device; e-mails, phones and plates become `***`, and
URLs lose their query and fragment, before anything leaves the browser.

Production builds emit hidden source maps; they stay out of the image, and
the release uploads them to Faro for the commit when the secret
`FARO_SOURCEMAP_API_KEY` is set, with the repository variables
`FARO_SOURCEMAP_ENDPOINT`, `FARO_SOURCEMAP_APP_ID` and
`FARO_SOURCEMAP_STACK_ID`; without the secret both steps are skipped and
the release goes on.

## Dashboards

`infra/observability/grafana/dashboards/` holds one JSON file per dashboard, named by its uid:

| uid | Shows |
|---|---|
| `motorfix-overview` | a row per service (api, worker, web, mcp, postgres, redis): up, rate, error %, p95, CPU, heap, release; Grafana Cloud usage beside the free-tier limits |
| `motorfix-api`, `motorfix-worker`, `motorfix-web`, `motorfix-mcp` | requests by route template, outside calls by host, the Node runtime, error logs and slow traces; the worker's jobs and outbox age |
| `motorfix-postgres`, `motorfix-redis` | the data-store readings (`motorfix_pg_*`, `motorfix_redis_*`) |
| `motorfix-queues` | every queue's waiting count, oldest waiting age, failures and job outcomes |
| `motorfix-web-vitals` | the browser's LCP, INP, CLS, TTFB and FCP by route, release and viewport class, and browser errors (Faro, in Loki) |
| `motorfix-product` | the seven product counters (`motorfix_*_total` in `libs/domain/src/metrics/`) per hour and per day |

Every dashboard picks the environment with its `env` variable, reads its
data sources through variables (never by name), and shows the deploy
annotations for that environment. Error panels link to the service's logs
and traces. `node scripts/dashboard-check.ts` (CI Checks job) holds them to
these rules.

The release pushes every file through Grafana's dashboard HTTP API, by uid,
after the images are built and before staging deploys ("Push the
dashboards"), and writes an annotation tagged `deploy` and `env:<environment>`
with the release sha after each deploy ("Annotate the deploy"). Both use the
secret `GRAFANA_SA_TOKEN` (a Grafana service account token, Editor) and the
repository variable `GRAFANA_URL` (the stack's address, which the api also
reads to link the admin panel to the overview). Without either, both are
skipped with a notice and the release goes on. A change made only in the
Grafana UI is overwritten by the next release: edit the JSON instead.

## Alert rules

`infra/observability/alerts/` holds one JSON file per rule group, in Grafana's
provisioning format (`apiVersion: 1`, folder `MotorFix`, every minute):
`api.json`, `web.json`, `worker.json`, `postgres.json` and `redis.json` for
the services, `mcp.json`, `notifications.json` and `quotes.json` for the
narrower signals. Each rule groups by `deployment_environment`, so an
environment that never reported raises nothing, and carries its `service`
label, a summary naming the environment, its dashboard's uid and a
`runbook` annotation (the first steps to take when it fires). Every rule says
how long it pends (`for`); only the rules whose query already holds the wait
(an absence over 5 minutes, a rate or an increase over its window, or one
event that is the alert) fire after `0s`, and `scripts/alert-rules.spec.ts`
lists them.

Whom they notify is code too, in `infra/observability/grafana/alerting/`:
`contact-points.json` holds two contact points, `MotorFix owner` (e-mail only
to the owner's address) and `motorfix-outage` (an e-mail to the admins,
uid `motorfix-outage-email`, and the API's webhook, uid
`motorfix-outage-webhook`), and `policies.json` the notification policy tree.
The rules name no receiver (the uptime `outage` rule aside, which names
`motorfix-outage`; the spec fails on a receiver the file does not declare):
the tree sends production to the owner at once (30 s, then every 4 hours while
it lasts) and staging more quietly (5 minutes, then once a day). No route
carries a mute or active time interval: an alert reaches the owner at any
hour, and the spec fails on one.

| Service | Signals (the file holds each threshold) | No data |
|---|---|---|
| api, web | down (no telemetry for 5 minutes after reporting in the last day), 5xx share over 10 minutes, p95 response time, memory over 85% of the container's limit (`api-memory`, `web-memory`); api also the garage search p95 over 300 ms for 10 minutes (`api-search-latency`) | OK |
| worker | down, event-loop delay, oldest waiting job per queue, waiting jobs growing for 15 minutes per queue (`worker-queue-growing`), a job's final failure per queue (`verification-result` keeps its own rule), memory (`worker-memory`) | `worker-queue-backlog` alerts |
| mcp | memory (`mcp-memory`, in `mcp.json`) beside its own signals | OK |
| PostgreSQL | unreachable, connections used, database size, the oldest outbox event waiting more than 60 s for 5 minutes (`postgres-outbox-stuck`) | `postgres-unreachable` alerts |
| Redis | unreachable, memory used, connected clients | `redis-unreachable` alerts |

Those three read a gauge that is always reported while its source is up
(the oldest waiting age starts at 0), so a missing series means the reading
stopped: they alert within about 11 minutes of the last sample (5 minutes of
staleness, the rule's 5 minutes, one evaluation). Every other rule keeps
`noDataState: OK`: a rate or share over no requests is rightly empty, the
`down` rules express absence themselves, and the threshold rules on the same
stores are covered by the unreachable ones.

The event-loop delay is the instrumentation's own p99, sampled every 10 ms;
the two live streams (`/api/v1/live`, `/api/v1/live/public`) are neither
traced nor in the HTTP duration histograms, so the p95 panels and rules read
requests only.

`motorfix_queue_failed_total` carries `service_version` like every metric:
Grafana Cloud promotes the `service.version` resource attribute onto each
one, and the version panels read it from `target_info`, so it stays on the
resource. Leaving it off one metric would need a second meter provider; the
metric's one reader, the queues dashboard, sums it with `max by (queue)`.

The `notifications` queue holds one failed job by design: the send job keeps
its last 1000 final failures (`removeOnFail: 1000`). That one failed before
telemetry reached Grafana (the gauge read 1 from its first sample on
2026-10-09, with no failure or retry counted since); which job it is can be
read only in the staging Redis.

The "Grafana alerts" workflow (`.github/workflows/grafana-alerts.yml`) applies
every file on a push to `main` that changes one, and by hand
(`workflow_dispatch`): it creates the `MotorFix` folder (uid `motorfix`) when
missing, puts every declared integration by its uid (creating it when Grafana
has none; the webhook only when `OUTAGE_WEBHOOK_TOKEN` and `STAGING_WEB_URL`
are set, see below), replaces the whole notification policy tree, then replaces each file's group whole, so a rule removed from a file
leaves Grafana too, and a group whose file is gone is left alone. It uses
`GRAFANA_SA_TOKEN` and `GRAFANA_URL`, as the release does, and without either
it is skipped with a notice. A change made only in the Grafana UI is
overwritten by the next run: edit the JSON instead. A file whose rule uid is
already held by a rule imported by hand fails, naming the file and the group; delete that
copy in Grafana once and run the workflow again. Once every declared
integration is in, the run removes any other contact point under a declared
name (one made by hand) and keeps every uid the repository declares, the
skipped webhook's included; when one of its own is refused, nothing is
removed.

## Uptime checks and the outage alert

Two Grafana Synthetic Monitoring HTTP checks watch staging from outside
(`uptime/checks.json`): Home (`motorfix-web`) and `/health/ready`
(`motorfix-api`, which answers 200 only while PostgreSQL, Redis and storage
answer),
each once a minute from one probe, failing after 10 seconds or on anything
but 200. That is 86,400 runs a month against the free tier's 100,000, so a
third check, or a second probe, does not fit.

The rule in `alerts/outage.json` fires when every run of a check failed for
3 minutes, one alert per service labelled `outage: "true"`, and resolves on
the first passing run. Its contact point `motorfix-outage` sends both to the
API's webhook, `POST /api/v1/monitoring/outage-alerts`, which sends every
active admin one e-mail and one push for "down" and again for "back"
(`ADMIN_OUTAGE_ALERT`, which no saved choice or quiet hours can mute). The
same alert sent again sends nothing more.

The contact point `motorfix-outage` and the rule `alerts/outage.json` are
applied by the Grafana alerts workflow (`grafana-alerts.yml`) from the
repository, never by hand; the checks are the one part set up by hand. Once
per stack:

1. Synthetic Monitoring › Checks: create the two checks from
   `uptime/checks.json`, `{PUBLIC_WEB_URL}` replaced by the environment's
   public web address.
2. The contact point's e-mail lists every admin's address (the fallback when
   the API itself is down) in `grafana/alerting/contact-points.json`, one
   string with the addresses separated by `;`: an admin who joins or leaves
   is an edit there, which the next run applies. Its webhook, to
   `{PUBLIC_WEB_URL}/api/v1/monitoring/outage-alerts` with
   `Authorization: Bearer <token>`, is applied only when the repository holds
   the GitHub secret `OUTAGE_WEBHOOK_TOKEN` and the GitHub variable
   `STAGING_WEB_URL` (the staging web address), both set by the owner;
   without either the run skips it with a notice and still applies the
   e-mail. It posts to the staging API only, as the checks watch staging:
   production has no webhook.
3. The API service in Railway: `OUTAGE_WEBHOOK_TOKEN`, the same token as the
   GitHub secret. Unset, the webhook refuses every call.
4. A changed secret or variable takes effect at the next run of the
   workflow: a push that changes a file it watches, or `workflow_dispatch`.

A failed nightly backup run (`.github/workflows/backup.yml`) is the backup
alert: GitHub e-mails the owner about the failed run.

## Product counters

Every product counter starts at 0 for each of its label combinations when
its process starts (`initProductCounters` in
`libs/domain/src/metrics/product-counters.ts`), so a panel shows 0 rather
than no data, and the Error % panels read `or vector(0)` for the same
reason. Each process starts only the series it writes.

Three counters cannot fire on staging today, and are kept at 0 until the
stories that reach them:

- `motorfix_garage_approvals_total` and `motorfix_verification_result_total`
  count the verification decision, which only the automatic approval reaches,
  and that holds only under `APP_ENV=test`; no admin approve or reject
  endpoint exists yet.
- `motorfix_documents_opened_total` counts the admin document download
  address, which no web screen calls yet.

`motorfix_decline_windows_closed_total` fires on a real decline, from the
worker's sweep or the garage's own decline.

## Inventory

`inventory.json` lists every app, Railway service, queue and outside service
with its dashboard uid and alert rule uids, or `"none"` and the reason, plus
the API's endpoint count. `node scripts/observability-inventory.ts` (CI Checks
job) fails while the code holds one it does not list, an entry outlives what
it names, a uid is not declared by a JSON file here, or the endpoint count is
stale (`--write` updates it). PostgreSQL, Redis and product counters are
listed by hand.

## Staying free

| Signal | Free-tier limit | Expected (staging + production, before launch) |
|---|---|---|
| Metrics | about 10k active series | about 1.5k series |
| Logs | 50 GB a month | under 3 GB a month |
| Traces | 50 GB a month | under 3 GB a month |
| Retention | 14 days, every signal | accepted |

Cost: **$0 a month**, and no Railway service, RAM or volume added.

Rules that keep it there:

- **Sampling.** Production keeps 20% of traces (`traceSampleRatio` 0.2);
  every other environment keeps all of them.
- **Low-cardinality labels.** A metric label takes a small fixed set of
  values: service, `env`, route template, method, status class, queue name.
  Never a user, garage, request, record or session id, a raw URL or an
  e-mail; those belong in logs and trace attributes.
- **Data-store figures.** The worker's PostgreSQL, Redis, outbox and object
  storage figures add at most 150 series per environment, every label value in
  use (`libs/observability/src/datastores/series.spec.ts` holds the ceiling);
  slow statements are WARN log records, never labels.
- **Product counters.** The `motorfix_*` counters add fewer than 100 series
  per process, one e-mail series per template key included, the seven
  product counters fewer than 50 (`libs/domain/src/metrics/product-counters*.spec.ts`
  hold the ceilings); a story that passes one cuts a label before raising it.
- Check usage in Grafana Cloud's billing dashboard when a story adds a signal;
  past half of any limit, cut before adding.

## Owner steps

Set in Railway by the owner; their values are never read, printed or
committed by the repo or its agents:

1. `MONITOR_DATABASE_URL` (the monitoring role) on the staging worker, and
   on production's when it is back. Until then `postgres-unreachable` fires
   on no data, as it should.
2. `FARO_URL` on the staging web, only once the analytics consent gate
   ships (the owner's decision, 2026-10-17). Until then it stays unset: the
   Web Vitals dashboard is empty, as expected, and the web warns once at
   start-up.
3. `GEOAPIFY_API_KEY` on the staging worker (its `address search off`
   warning says so).
4. Optional: read the `notifications` queue's one failed job in the staging
   Redis, if which job it was matters.
