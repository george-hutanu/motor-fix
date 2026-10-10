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

Alert rules go in `infra/observability/alerts/`; ST-880 adds them.

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

Set up by hand in Grafana Cloud, once per stack (nothing here calls its API):

1. Synthetic Monitoring › Checks: create the two checks from
   `uptime/checks.json`, `{PUBLIC_WEB_URL}` replaced by the environment's
   public web address.
2. Alerting › Contact points: `motorfix-outage`, a webhook to
   `{PUBLIC_WEB_URL}/api/v1/monitoring/outage-alerts` with the header
   `Authorization: Bearer <token>`, and an e-mail integration listing every
   admin's address (the fallback when the API itself is down; kept current
   by hand when an admin joins or leaves).
3. The API service in Railway: `OUTAGE_WEBHOOK_TOKEN`, the same token. Unset,
   the webhook refuses every call.
4. Alerting › Alert rules: import `alerts/outage.json`.

A failed nightly backup run (`.github/workflows/backup.yml`) is the backup
alert: GitHub e-mails the owner about the failed run.

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
- Check usage in Grafana Cloud's billing dashboard when a story adds a signal;
  past half of any limit, cut before adding.
