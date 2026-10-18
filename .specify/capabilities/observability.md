---
capability: observability
updated: 2026-10-18
features:
  - 875-observability-stack
  - 876-otel-instrumentation
  - 881-observability-current
  - 915-telemetry-flush-on-stop
  - 924-inventory-real-calls
  - 877-web-health-grafana
  - 878-data-store-metrics
  - 916-otlp-log-masking-coverage
  - 365-mcp-oauth
  - 879-dashboards
  - 397-listing-ticks
  - 343-live-quote-requests
  - 374-assistant-requests
  - 1016-mcp-staging
  - 344-send-quote
  - 244-analytics-news-consent
  - 209-status-change-emails
  - 251-monitoring-backups
  - 1024-alert-rules
  - 1182-cache-service
  - 1175-valkey
  - 1169-prefetch-intent
  - 1235-unknown-brand-cache
  - 294-status-health-checks
  - 880-grafana-alerts
  - 297-system-status-log
  - 1345-staging-observability
  - 1347-outage-contact-point
  - 280-contact-motorfix
  - 299-system-log-search
  - 173-price-range-in-place
  - 1174-postgres-18-pitr
  - 1178-keycloak-sizing
  - 1348-release-green
---

# Capability: Observability

Telemetry to Grafana Cloud's free tier through the standard OTLP variables, read by one contract in `libs/contracts`; the local `observability` compose profile; dashboards and alerts as code under `infra/observability/`.

## Requirements

### 875-FR-001 — `libs/contracts` MUST name the telemetry variables `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` and `OTEL_EXPORTER_OTLP_PROTOCOL`, all optional, and offer one function that reads them: unset or empty endpoint → telemetry off.

_From 875-observability-stack._

### 875-FR-002 — When the endpoint is set, the function MUST return the endpoint as an absolute http(s) URL, the headers when set, the protocol `http/protobuf` (the default when unset; any other value is refused), the `env` label equal to `APP_ENV`, and a trace sampling ratio of 0.2 when `APP_ENV` is `production` and 1 otherwise.

_From 875-observability-stack._

### 875-FR-003 — A malformed endpoint or a refused protocol MUST fail with the variable's name and MUST NOT print any value.

_From 875-observability-stack._

### 875-FR-004 — `.env.example` MUST list the three variables by name with no value and a comment naming Grafana Cloud's OTLP gateway for staging and production and `http://localhost:4318` for local development.

_From 875-observability-stack._

### 875-FR-005 — `docker compose` MUST offer an `observability` profile that starts `grafana/otel-lgtm` at an exact version with Grafana on `${GRAFANA_PORT:-3300}` and OTLP on 4317 and 4318; without the profile the compose stack MUST be unchanged.

_From 875-observability-stack._

### 875-FR-006 — The CI Compose stack step MUST boot the `observability` profile and fail unless Grafana's `/api/health` answers and an OTLP/HTTP POST to port 4318 is accepted.

_From 875-observability-stack._

### 879-FR-016 — `infra/observability/README.md` MUST name the dashboards folder, the ten uids, the push and annotation steps and their secret and variable (names only), and that a change made only in Grafana's UI is overwritten by the next release.

_From 879-dashboards._

### 875-FR-008 — No observability service, environment or volume MUST exist on Railway for this epic, and no Grafana Cloud value MUST be committed, read or printed by this work.

_From 875-observability-stack._

### 876-FR-001 — One shared telemetry module MUST be loaded before each of the API, worker and MCP applications starts, and MUST read its configuration only through `telemetry()` from the contracts library: when it returns off, the module MUST start nothing and register no hooks; it MUST never read or print the headers' value.

_From 876-otel-instrumentation._

### 876-FR-002 — When telemetry is on, every span, metric and log record MUST carry as resource attributes the service name (`service.name`: `api`, `worker` or `mcp`), the deployment environment (`deployment.environment` = `telemetry().env`) and the service version (`service.version` = `RELEASE_SHA`, `dev` when unset).

_From 876-otel-instrumentation._

### 876-FR-003 — Every API request MUST be a span named by its route template and method, never the raw path; an unmatched route MUST use one fixed label. Requests to `/health/*` MUST produce no span.

_From 876-otel-instrumentation._

### 876-FR-004 — Every database query, Redis command, queued-job run and outgoing call to the e-mail provider, the object store, the push service and the Google and Apple sign-in endpoints MUST be a child span of the request or job that made it. A database or Redis span MUST carry the operation, the table or command name and the host, never the statement text, its parameters or command arguments; an outside-call span MUST carry the method, host and status, never the query string or body. File-system, DNS and raw socket operations MUST NOT be spans.

_From 876-otel-instrumentation._

### 876-FR-005 — A job queued during a traced request MUST carry that trace context with the job (BullMQ's own telemetry carrier when the installed version has one, else one reserved key removed before the handler runs), and the worker's job span MUST be a child in that trace; a job without context MUST start a new trace. The handler's view of the job's payload MUST be unchanged.

_From 876-otel-instrumentation._

### 876-FR-006 — Every log line of the three services MUST carry the trace id and span id when one is active, beside the request id (API) or the job id (worker), and MUST hold no personal data.

_From 876-otel-instrumentation._

### 876-FR-007 — An API request ending in a server error (5xx) and a job failing on its final attempt MUST write one error log line carrying the trace id (the guarantee for every error, sampled or not), and MUST set the span status to error with the exception recorded (exported when the trace is sampled).

_From 876-otel-instrumentation._

### 876-FR-008 — The API MUST report a request-duration histogram (the OTel instrument `http.server.request.duration`) labelled by route template, method and status, sufficient to derive request rate, error rate and duration per route. (Amended 2026-10-17: the request-duration histogram leaves out the two live event streams (1345-FR-008).)

_From 876-otel-instrumentation._

### 876-FR-009 — The worker MUST report `motorfix_jobs_total` by queue, job name and outcome and `motorfix_job_duration_seconds` by queue and job name, and, for every queue the worker opens, `motorfix_queue_waiting`, `motorfix_queue_oldest_waiting_seconds` and `motorfix_queue_failed_total` by queue, read every 15 s.

_From 876-otel-instrumentation._

### 876-FR-010 — The API, worker and MCP MUST report the Node runtime metrics (event-loop lag, heap, garbage collection, CPU). (Amended 2026-10-17: the event-loop delay is sampled at the instrumentation's default resolution, never a precision of a second or more (1345-FR-001).)

_From 876-otel-instrumentation._

### 876-FR-011 — Metric labels MUST take values only from small fixed sets (route template, method, status, queue, job name, outcome; service and environment are resource attributes, not labels); no id of any kind, raw path or URL, e-mail, phone, plate, address or message text MUST appear as a metric label. Span attributes MAY carry record ids, the job id and the request path (they cost no series and make a trace findable by request or job id, FR-015), and MUST NOT carry an e-mail, phone, plate, address, message text, query string or body (FR-004, FR-012).

_From 876-otel-instrumentation._

### 876-FR-012 — E-mail addresses, Romanian phone numbers and number plates MUST be replaced by `***` in span attributes, OTLP log records, the JSON log lines written to stdout (Railway keeps them), and recorded exception messages and stack traces; the scrubber works on the copy being written or exported and never mutates the application's own error objects or the values it passes to the logger.

_From 876-otel-instrumentation._

### 876-FR-013 — Export MUST be fire-and-forget: parent-based head sampling at `telemetry().traceSampleRatio` (a local parent's decision is followed; a root or remote parent is sampled by the ratio, never by an incoming sampled flag), batched export, a metric export interval no shorter than 60 s; an exporter or SDK failure MUST never fail, block or crash a request, a job or a service, and MUST be logged at most once per batch. Export queues MUST be bounded (records are dropped when full, never buffered without limit) and each export call MUST time out (OTLP exporter default, 10 s) so an unreachable endpoint cannot hold memory or delay shutdown; on SIGTERM/SIGINT the providers flush within those bounds and the process exits as before.

_From 876-otel-instrumentation._

### 876-FR-014 — With the endpoint unset the services MUST behave as today, apart from FR-012's masking of the stdout log line: no SDK started, no SDK module imported (so no per-request work is added, verifiable by the absence of any registered provider or hook), and the existing test suites unchanged in outcome.

_From 876-otel-instrumentation._

### 876-FR-015 — The PR body's Notes MUST list the observability reports the signals make possible (per-route latency and error dashboards, queue health, job outcomes, runtime saturation, trace search by request or job id), for ST-879 and ST-880 to build on.

_From 876-otel-instrumentation._

### 881-FR-001 — The repository MUST hold one observability inventory file, `infra/observability/inventory.json`, listing every app under `apps/`, every Railway service named in `scripts/railway-deploy.ts`, every queue the code opens, every outside service the code calls and every product counter the code reports, each with: `kind`, `name`, `source` (the file or declaration it was discovered from), `dashboard` (a dashboard uid or `"none"`), `alerts` (one or more alert rule uids or `"none"`), `reason` (required whenever `dashboard` or `alerts` is `"none"`) and `story` (the `ST-n` that owns the entry); plus the API endpoint count and its source (`apps/api/openapi.json`).

_From 881-observability-current._

### 879-FR-012 — `infra/observability/inventory.json` MUST list each counter as a `product-counter` entry (`source` the file that increments it, `dashboard` `motorfix-product`, `alerts` `"none"` with the reason that ST-880 adds them, `story` ST-879), and every existing entry whose `"none"` reason named this story MUST point at its dashboard uid as the Clarifications table says (apps and Railway services at their service's dashboard; queues at `motorfix-queues`; PostgreSQL and Redis at theirs; an outside service at the dashboard of the service that calls it; grafana-faro at `motorfix-web-vitals`); `web-e2e` and `openfreemap` stay `"none"` with their own reasons. `node scripts/observability-inventory.ts` MUST pass.

_From 879-dashboards._

### 924-FR-001 — The check (`scripts/observability-inventory.ts`) MUST discover from the code, without reading any environment variable: every directory under `apps/`; every service name in `scripts/railway-deploy.ts`; every queue name from `new Queue(…)`, `registerQueue(…)` and an outbox consumer's `queue:` in non-test, non-generated source under `libs/` and `apps/`, resolving a name given as an exported constant; every outside host whose `https://<host>` begins a string literal (single-quoted, double-quoted or template) in that code, except hosts under the reserved TLDs `.example`, `.test`, `.invalid`, `.localhost`; and every known SDK client (`S3Client`, `web-push`) in that code. Every matcher (hosts, queues, exported constants, SDK clients) MUST read the file with its comments (`//` line, `/* */` block, `/** */` doc comments) removed and its string literals kept as written, so nothing inside a comment is discovered; a link that does not begin its string literal (prose) MUST NOT be discovered as a host. A `'` or `"` string ends at its unescaped closing quote or at the end of the line (`\` escapes the next character); a template literal may span lines and is one literal, `${…}` included. `libs/data-access/`, `libs/domain/src/generated/`, `*.spec.ts`, `*.testing.ts` and test stubs are not scanned. A `new Queue(<identifier>)` whose identifier is not an exported string constant is skipped. Product counters, PostgreSQL and Redis are hand-listed, not discovered. It MUST fail (non-zero exit) naming each discovered item the inventory does not list (kind, name, file) and each stale inventory entry (a discovered kind the check no longer discovers, or a hand-listed entry whose `source` path no longer exists); `--root <dir>` runs it against another tree; with nothing wrong it MUST print one summary line and exit zero.

_From 924-inventory-real-calls._

### 881-FR-004 — The check MUST fail naming the entry when an entry's `dashboard` is a uid that no `*.json` file under `infra/observability/` declares as its top-level `uid`, when an `alerts` uid is one no such file declares at `groups[].rules[].uid`, or when `"none"` has no reason. With no dashboard or alert file yet, nothing is declared, so an inventory of `"none"` entries passes before ST-879/ST-880 land.

_From 881-observability-current._

### 881-FR-005 — The check MUST compare the inventory's endpoint count with the number of operations in `apps/api/openapi.json`: `--write` MUST update the inventory's count; without it a differing count MUST fail naming both numbers.

_From 881-observability-current._

### 881-FR-006 — The check MUST run as its own step of the CI Checks job in `.github/workflows/ci.yml`, beside Biome, Typecheck and Build, running even after an earlier step failed like the others, and it MUST be runnable locally with `node scripts/observability-inventory.ts` from the repository root.

_From 881-observability-current._

### 881-FR-007 — The check MUST have a colocated Jest spec (`scripts/observability-inventory.spec.ts`, run by the scripts project like `scripts/pr-body-check.spec.ts`) that builds a fixture repository in `os.tmpdir()` and runs the check against it with `--root`: an unlisted queue, app and outside client fail naming each; listed, they pass; a dashboard uid no file declares fails; `"none"` without a reason fails; a stale endpoint count fails and `--write` repairs it. The spec MUST also assert the check passes on this repository.

_From 881-observability-current._

### 881-FR-008 — `.github/pull_request_template.md` MUST gain an `## Observability` section between "How it was tested" and "UI evidence", asking what the change adds (service, queue, endpoint, outside call, product action) and the signals, dashboard panel and alert that come with it, or `N/A` and the reason. `scripts/pr-body-check.ts` MUST, by its existing rules, fail a ready PR whose section is empty, a placeholder or a bare `N/A`, and pass one with content or `N/A` and a reason; a draft needs only the heading. `scripts/pr-body-check.spec.ts` covers the new section.

_From 881-observability-current._

### 881-FR-009 — `.specify/templates/plan-template.md` MUST gain an `## Observability` section asking what the change adds (service, resource, queue, outside call, endpoint, product action) and which metrics, logs, traces, dashboard panel and alert rule it adds or why not, pointing at the inventory and the check.

_From 881-observability-current._

### 881-FR-010 — `AGENTS.md` MUST state the rule: every story that adds a service, resource, queue, outside call, endpoint or product action adds its metrics, logs, traces, dashboard panel and alert (or says why not) in the same PR, kept by `infra/observability/inventory.json` and its check; and `.specify/memory/constitution.md` MUST carry the same rule as an Additional Constraint in a PATCH amendment 1.8.2 → 1.8.3, with the Sync Impact Report, the version line and `.specify/memory/constitution-card.md` updated so `constitution-card.spec.mjs` passes.

_From 881-observability-current._

### 881-FR-011 — `infra/observability/README.md` MUST name the inventory and the check in one short paragraph; `.specify/capabilities/observability.md` is updated by `/speckit-archive` through this feature's Spec Delta, not by hand.

_From 881-observability-current._

### 881-FR-012 — Nothing in this feature MUST read, print or commit an OTLP endpoint, header or token value or any Railway value; only variable names appear.

_From 881-observability-current._

### 881-FR-013 — The whole change MUST stay small (Constitution I): one inventory file, one check script with one colocated spec, the CI step, and small edits to the PR template, its check's spec, the plan template, AGENTS.md, the constitution and card, and the README. No new dependency.

_From 881-observability-current._

### 915-FR-001 — With telemetry on, the graceful stop of api and of worker MUST shut the telemetry providers down after the rest of the app has closed (on the signal the app raises again at the end of its close, FR-005), and MUST NOT complete until that shutdown has finished (pending spans, metrics and logs exported) or the bound of FR-002 has passed, whichever comes first.

_From 915-telemetry-flush-on-stop._

### 915-FR-002 — The wait of FR-001 and FR-005 MUST be bounded at 5 s from the first request for the telemetry shutdown, the export timeout every telemetry export already has; a telemetry shutdown that fails, hangs or outlasts the bound MUST NOT fail the stop or delay it beyond the bound.

_From 915-telemetry-flush-on-stop._

### 915-FR-003 — The telemetry providers MUST be shut down at most once per process; every later request waits on the same shutdown and the same bound.

_From 915-telemetry-flush-on-stop._

### 915-FR-004 — With telemetry off, the graceful stop MUST NOT wait, load or export anything.

_From 915-telemetry-flush-on-stop._

### 915-FR-005 — On a stop signal, the telemetry MUST be shut down by the signal only when no other listener handles that signal; the signal MUST then be raised again once the shutdown has finished or the bound of FR-002 has passed. When another listener handles it (the app's own stop), the signal MUST NOT start the shutdown. "Another listener" is any other listener registered on that signal in the process. The process exit code is unchanged: the re-raised signal ends the process as today.

_From 915-telemetry-flush-on-stop._

### 924-FR-002 — The colocated spec (`scripts/observability-inventory.spec.ts`) MUST cover, against a fixture tree: a host only in a line comment, a block comment and a doc comment is not reported; a host inside prose in a string is not reported; an SDK client named only in a comment is not reported; an unlisted host beginning a single-quoted, double-quoted or template string is reported; a real call followed by a commented link on the same line reports only the real host; a string holding `/*` does not hide the real call after it; a regular-expression literal with a lone quote does not hide a real host on the next line; a commented-out `new Queue('x')` is not a queue; a listed host whose only mention moves into a comment is reported stale.

_From 924-inventory-real-calls._

### 924-FR-003 — On this repository the check MUST still pass with the inventory unchanged, and the change MUST add no dependency (Constitution I): `package.json` and the lockfile stay unchanged, and comment and string handling lives in the check itself, not in a TypeScript parser.

_From 924-inventory-real-calls._

### 877-FR-001 — The web server MUST load the shared telemetry module before it starts, with service name `web`, reading its configuration only through `telemetry()`; with it off, the web server MUST start nothing and behave as today (876-FR-001, 876-FR-014 applied to `web`).

_From 877-web-health-grafana._

### 877-FR-002 — Every server-rendered page request MUST be one span named by its Angular route template and method, never the raw path; an unmatched route MUST use the fixed label `unmatched`. The template MUST come from the rendered app's router state (the deepest matched route's configured path), never from a second route table on the server. Static file requests and `/health/*` MUST produce no span.

_From 877-web-health-grafana._

### 877-FR-003 — The `/api/` pass-through MUST be a span with a child span for the outgoing call to the API that carries the trace context to the API, so the API's request span joins that trace; an incoming `traceparent` from the browser MUST be honoured as the parent.

_From 877-web-health-grafana._

### 877-FR-004 — The web server MUST report the request-duration histogram (`http.server.request.duration`) labelled by route template, method and status, and the Node runtime metrics, with labels from small fixed sets only (876-FR-008, -010, -011). (Amended 2026-10-17: the request-duration histogram leaves out the two live event streams (1345-FR-008).)

_From 877-web-health-grafana._

### 877-FR-005 — The web server's log lines MUST carry the trace id and span id when one is active; a request ending in a server error MUST write one error log line with the trace id and mark the span as error; e-mails, Romanian phone numbers and plates MUST be masked in spans, logs and exceptions (876-FR-006, -007, -012). (Amended 2026-10-17: a proxy failure record carries the method and the masked path, and one after the response started is WARN (1345-FR-009, 1345-FR-010).)

_From 877-web-health-grafana._

### 877-FR-006 — `/health/ready` on the web server MUST answer ok only when the API's `/health/ready` answers any 2xx within 2 s; otherwise it MUST answer 503. Each probe MUST call the API once; no result is cached. `/health/live` MUST stay unconditional.

_From 877-web-health-grafana._

### 877-FR-007 — The web server MUST read the browser collector URL from its runtime configuration (one optional variable, proposed `FARO_URL`, an absolute https URL in staging and production) and hand it, with the release version, to the browser inside the HTML it renders (no new endpoint); unset or empty → no browser telemetry and no telemetry code loaded in the browser. A malformed value MUST fail at start naming the variable and never print its value. `.env.example` MUST list the variable by name with no value. (Amended 2026-10-17: an unset collector URL with telemetry on is one warning (1345-FR-005).)

_From 877-web-health-grafana._

### 877-FR-008 — When the collector URL is set, the browser MUST send LCP, INP, CLS, TTFB and FCP for each page, each labelled with the route template, the app version (`RELEASE_SHA`) and the viewport class (phone < 768 px, tablet 768–1199 px, desktop ≥ 1200 px).

_From 877-web-health-grafana._

### 877-FR-009 — When the collector URL is set, the browser MUST send each uncaught JavaScript error and unhandled promise rejection with the route template, app version and stack; at most 20 errors per page load, after the SDK's own deduplication.

_From 877-web-health-grafana._

### 877-FR-010 — Before anything leaves the browser, e-mail addresses, Romanian phone numbers and number plates MUST be replaced by `***` in error messages, stacks and any attribute, and every URL-valued attribute, the page URL included, MUST be sent without its query string or fragment.

_From 877-web-health-grafana._

### 877-FR-011 — Browser telemetry MUST create and send no session id, user id or device id, set no cookie, record no session replay or user journey, and leave nothing of its own in local storage, session storage or IndexedDB once the page has loaded and sent. The SDK's transient availability probe (one test key set and removed again at load, plan.md R3) and the tracing sampling flag (a session attribute with no id, removed before sending) are permitted because nothing persists and nothing leaves the device.

_From 877-web-health-grafana._

### 877-FR-012 — Browser requests to the web app's own origin MUST carry a `traceparent` header from a browser span that is exported to the collector; requests to any other origin MUST carry no trace header.

_From 877-web-health-grafana._

### 877-FR-013 — The browser telemetry MUST add less than 30 kB gzipped to Home's Angular `initial` bundle, measured against the build without it; the SDK itself MUST be loaded with a dynamic import once the page is idle. ST-249's 250 kB whole first-load budget is measured beside it.

_From 877-web-health-grafana._

### 877-FR-014 — A collector or SDK failure MUST never break, block or slow a page or a server request; export is batched and bounded, and failures are dropped silently in the browser (876-FR-013 applied to `web`).

_From 877-web-health-grafana._

### 877-FR-015 — The release MUST upload the web app's source maps to Grafana Cloud for that release's version when the upload credential is configured, skip it (and still succeed) when it is not, and the web app MUST NOT serve source maps publicly.

_From 877-web-health-grafana._

### 877-FR-016 — `infra/observability/inventory.json` MUST stay passing under `scripts/observability-inventory.ts`; the `web` entries and the new outside service (Grafana Cloud Frontend Observability) MUST be listed with dashboard and alerts `"none"` and the reason that ST-879 and ST-880 add them.

_From 877-web-health-grafana._

### 877-FR-017 — Unit tests MUST cover the browser masking and the route-template mapping; one Playwright test MUST load Home with the collector stubbed and assert that a Web Vitals payload is sent and holds no personal data, no id and no trace header to the collector.

_From 877-web-health-grafana._

### 877-FR-018 — The PR's Observability section MUST list the signals added (web traces, request metrics, runtime metrics, logs, browser Web Vitals and errors) and the reports they make possible (per-route render latency and errors, Web Vitals by route and viewport class, browser error rate per release) for ST-879 and ST-880.

_From 877-web-health-grafana._

### 878-FR-001 — A database migration MUST create the role `motorfix_monitor` (when it does not exist) able to log in, member of `pg_monitor` only, with no other grant and no password in the migration, and MUST create the `pg_stat_statements` extension when it does not exist. The role's password MUST come from a deployment variable, `MONITOR_DATABASE_PASSWORD`, applied at deploy time and never printed.

_From 878-data-store-metrics._

### 878-FR-002 — The worker MUST read PostgreSQL through a separate connection, `MONITOR_DATABASE_URL` (optional), whose sessions are read-only, with a 5 s statement timeout; no other part of the system uses it. Unset, the PostgreSQL readings are off (one log line). (Amended 2026-10-17: an unset `MONITOR_DATABASE_URL` is one WARN record through the OTel log pipeline and its stdout line (1345-FR-002).)

_From 878-data-store-metrics._

### 878-FR-003 — Every 60 s while telemetry is on, the worker MUST read and report for the current database: `motorfix_pg_connections` by `state` (`active`, `idle`, `idle_in_transaction`, `other`), `motorfix_pg_connections_max`, `motorfix_pg_locks_waiting` (sessions waiting on a lock), `motorfix_pg_database_size_bytes`, and the cumulative `motorfix_pg_transactions_total` by `outcome` (`commit`, `rollback`) and `motorfix_pg_deadlocks_total`.

_From 878-data-store-metrics._

### 878-FR-004 — On the same reading, when `pg_stat_statements` is readable, the worker MUST report `motorfix_pg_slow_statements` (statements of the current database with mean run time over 500 ms whose call count grew since the previous reading; the first reading only records the baseline and reports 0) and write one log record per such statement whose call count grew since the previous reading (at most 10 per reading, slowest first), carrying the normalised text, the mean and max time in ms and the calls; the text MUST NOT be a metric label.

_From 878-data-store-metrics._

### 878-FR-005 — On the same timer, the worker MUST read Redis `INFO` and report `motorfix_redis_memory_used_bytes`, `motorfix_redis_memory_max_bytes`, `motorfix_redis_clients_connected`, and the cumulative `motorfix_redis_evicted_keys_total`, `motorfix_redis_keyspace_hits_total` and `motorfix_redis_keyspace_misses_total`, and `motorfix_redis_keys` by `db`.

_From 878-data-store-metrics._

### 878-FR-006 — On the same timer, the worker MUST report `motorfix_outbox_oldest_pending_seconds`: the age of the oldest outbox event not yet relayed, 0 when none.

_From 878-data-store-metrics._

### 878-FR-007 — The worker MUST report `motorfix_datastore_up` by `store` (`postgres`, `redis`, and `keycloak` when its metrics address is set): 1 when the last reading of that store succeeded, 0 when it failed (a reading that has not answered within 5 s for PostgreSQL and Keycloak, 2 s for Redis counts as failed; `keycloak` amended by ST-1178). A failed reading MUST report none of that store's other figures for that cycle, MUST log one error line per failure streak, and MUST NOT affect jobs, the relay or health checks.

_From 878-data-store-metrics._

### 878-FR-008 — The readers MUST only read: PostgreSQL through the read-only monitoring session, Redis through `INFO` only, the outbox through one `SELECT`. No reader writes anything to any store.

_From 878-data-store-metrics._

### 878-FR-009 — Every queue in the observability inventory (`infra/observability/inventory.json`, kind `queue`) MUST report `motorfix_queue_waiting`, `motorfix_queue_oldest_waiting_seconds` and `motorfix_queue_failed_total` from the worker (the existing 15 s readings, unchanged); an integration test that boots the worker's modules with the configuration every queue needs MUST fail, naming the queue, when one does not.

_From 878-data-store-metrics._

### 878-FR-010 — Every object-store call the storage service makes MUST be a span `S3 <Operation>` with attributes `rpc.method` (the operation) and `aws.s3.bucket`, never the key, ended in error on failure (a 404 answer is not a failure: it counts as `ok`); and MUST count in `motorfix_storage_requests_total` by `operation` and `outcome` (`ok`, `error`) and record `motorfix_storage_request_duration_seconds` by `operation`. The health probe's HeadBucket is a call; signing a URL locally is not. The duration histogram uses the existing duration buckets.

_From 878-data-store-metrics._

### 878-FR-011 — With telemetry off, none of the above MUST run: no timer, connection, instrument or span; the services behave as today.

_From 878-data-store-metrics._

### 878-FR-012 — Every new metric label MUST take its values from the fixed sets named here; no statement text, key, id or host is a label (876-FR-011).

_From 878-data-store-metrics._

### 878-FR-013 — `.env.example` MUST name `MONITOR_DATABASE_URL` and `MONITOR_DATABASE_PASSWORD` with no value; the local compose PostgreSQL and CI's PostgreSQL MUST have `pg_stat_statements` preloaded, by the repository's database image itself (no `ALTER SYSTEM` or restart step), so the slow-statement reading is tested, never skipped.

_From 878-data-store-metrics._

### 878-FR-014 — The PR body's Observability section MUST list every new metric, the slow-statement log record and the storage spans, and the inventory MUST stay passing.

_From 878-data-store-metrics._

### 916-FR-001 — A colocated unit spec in `libs/domain` MUST write a log line through `JsonLogger` while telemetry is started by `startTelemetry` with the in-memory exporters from `@motor-fix/observability`'s testing helpers (the whole `inMemory()` set) in place of the OTLP ones, flush the telemetry, and read the record from that exporter: the same pipeline (logger provider, batching processor) the services use, with only the exporter swapped.

_From 916-otlp-log-masking-coverage._

### 916-FR-002 — The exported record's body MUST read the message with the e-mail address, the Romanian phone number and the number plate each replaced by `***`, and no raw value MUST appear anywhere in the exported record, body or attributes (checked on the serialised record).

_From 916-otlp-log-masking-coverage._

### 916-FR-003 — For a structured entry whose fields hold an e-mail, a phone and a plate, the exported record's body MUST be that object's JSON with each value replaced by `***`; for an `Error` carrying the same values, the record's `error` and `stack` attributes MUST carry them masked; in both, no raw value MUST appear anywhere in the record.

_From 916-otlp-log-masking-coverage._

### 916-FR-004 — The exported record MUST carry the request id, the job id (one that looks like a plate included) and the active span's trace id and span id unchanged, both as the `trace_id`/`span_id` attributes and as the record's span context.

_From 916-otlp-log-masking-coverage._

### 916-FR-005 — The change MUST be test-only and small (Constitution I): no product source file under `apps/` or `libs/*/src` other than `*.spec.ts` changes, no new dependency, the existing cases of `libs/domain/src/logging.spec.ts` stay as they are, and the new spec runs in `npm run test:unit` (it needs no PostgreSQL, Redis or network).

_From 916-otlp-log-masking-coverage._

### 365-FR-015 — The server MUST record its metrics (requests by outcome, tool calls by tool and outcome, authentication failures by reason, tool-call duration), one log line per call with no token and no user text, and traces through the existing telemetry (the request id is a trace attribute); metric labels come from closed sets only (tool name, outcome, failure reason; never an account, client or token); the identity server's key fetch has its own success/failure counter so an outage is visible while cached keys still serve; the Grafana dashboard gets an MCP panel and an alert on authentication-failure spikes and tool-error rate; `infra/observability/inventory.json` lists the MCP endpoint, the identity server's key fetch (outside call) and the three assistant endpoints of the API. (D17; AGENTS.md observability rule)

_From 365-mcp-oauth._

### 879-FR-001 — The repository MUST hold one JSON file per dashboard under `infra/observability/grafana/dashboards/`, with the uids `motorfix-overview`, `motorfix-api`, `motorfix-worker`, `motorfix-web`, `motorfix-mcp`, `motorfix-postgres`, `motorfix-redis`, `motorfix-queues`, `motorfix-web-vitals` and `motorfix-product`, each with a title starting "MotorFix".

_From 879-dashboards._

### 879-FR-002 — Every dashboard MUST carry an `env` templating variable whose values come from the environment attribute of the signals, with no environment name written into any query, title or link, and every panel MUST filter by it, so one dashboard serves staging and production.

_From 879-dashboards._

### 879-FR-003 — Every dashboard MUST reference its datasources only by uid or by a dashboard datasource variable, never by display name, so the same file loads in Grafana Cloud and in the local `otel-lgtm` stack with its variables set.

_From 879-dashboards._

### 879-FR-004 — Every dashboard MUST show the deploy annotations (tag `deploy` and the selected `env`) over its time range.

_From 879-dashboards._

### 879-FR-005 — The overview dashboard MUST show one row per service — api, worker, web, mcp, postgres, redis — with up/down, request (or operation) rate, error %, p95 latency, CPU, memory and the deployed release sha (the service version resource attribute) for the four apps, and for the two data stores the figures ST-878 exports (PostgreSQL: up, connections, transactions/s; Redis: up, memory, commands hit ratio), since a managed store reports no request, CPU or release signal, where error % is 5xx responses over all responses, p95 latency and rates use a 5-minute window, and up means the service's `target_info` series is present (OTLP push yields no `up` series; data stores: `motorfix_datastore_up` reads 1), down means it reads 0, and no series in the last 5 minutes shows "No data", never down, and one Grafana Cloud usage row with active metric series, log volume and trace volume for the period beside the free-tier limits. (Amended 2026-10-17: error % reads 0 with no 5xx (1345-FR-015).)

_From 879-dashboards._

### 879-FR-006 — Every panel of the overview and of the service dashboards that shows errors MUST carry data links to the service's logs (Loki, filtered by service and `env`) and traces (Tempo, filtered by service and `env`) for the panel's time range.

_From 879-dashboards._

### 879-FR-007 — The service dashboards MUST show, per service, what the capability spec's signals allow: API and MCP requests by route template with rate, errors and duration and the outside calls they make; worker jobs by queue, name and outcome with duration, failures and the outbox's oldest pending age; web server renders by route template with errors and the ready state; the Node runtime (event-loop lag, heap, GC, CPU) on each of the four; PostgreSQL's up, connections against maximum, transactions, deadlocks, waiting locks, database size and slow statements; Redis's up, memory against maximum, clients, keys, hit rate and evictions; every inventoried queue's waiting count, oldest waiting age and failed count; the browser's LCP, INP, CLS, TTFB and FCP by route template and viewport class and browser errors.

_From 879-dashboards._

### 879-FR-008 — The product dashboard MUST show searches, sign-ins, garage sign-ups, garage approvals, quotes, e-mails sent and notifications sent, each per hour and per day for the selected `env`, computed from the product counters alone (no panel queries the database); "per hour" and "per day" mean the counter's increase over the trailing 1 h and trailing 24 h at the dashboard's current time, not calendar buckets.

_From 879-dashboards._

### 879-FR-009 — The domain lib MUST report seven OpenTelemetry counters, incremented once per successful action in the use case that performs it (never by reading the database): `motorfix_searches_total{outcome}` (results | none), `motorfix_sign_ins_total{method}` (password | phone | google | apple), `motorfix_garage_sign_ups_total` (incremented where a garage listing draft is created until a use case creates garage accounts), `motorfix_garage_approvals_total{outcome}` (approved | rejected), `motorfix_quotes_total` (incremented where the quote-received notification is sent until a quote use case exists), `motorfix_emails_sent_total{template}` and `motorfix_notifications_sent_total{channel}` (push | in-app). (Amended 2026-10-17: every product counter starts at 0 per label combination in the process that writes it (1345-FR-012).)

_From 879-dashboards._

### 244-FR-018 — No counter label MAY carry a user, garage, request or record id, an e-mail, phone, plate, address or free text; labels take values only from fixed sets (876-FR-011), and the series all product counters add per instance, the consent counter included, MUST stay under 60, asserted by a unit test. (Replaces 879-FR-010's "seven counters under 50": its test already counted every product counter and stood at 49, so the three consent series need the room; 60 stays far inside the 1.5k-of-10k series budget.)

_From 244-analytics-news-consent._

### 251-FR-018 — No counter label MAY carry a user, garage, request or record id, an e-mail, phone, plate, address or free text; labels take values only from fixed sets, and the series the product counters add per instance MUST stay under 60, asserted by a unit test. The outage alert's two e-mail templates add two series; with ST-209's status e-mails, merged first and already asserting under 60, the total is 56.

_From 251-monitoring-backups._

### 879-FR-011 — With telemetry off the counters MUST be no-ops with no behaviour change to the use cases (876-FR-014); each counter MUST have a colocated test that runs the action with a metrics reader attached and asserts the increment and its labels, and a failed action (a refused sign-in, a search that throws) MUST count nothing. (Amended 2026-10-17: every product counter starts at 0 per label combination in the process that writes it (1345-FR-012).)

_From 879-dashboards._

### 879-FR-012 — `infra/observability/inventory.json` MUST list each counter as a `product-counter` entry (`source` the file that increments it, `dashboard` `motorfix-product`, `alerts` `"none"` with the reason that ST-880 adds them, `story` ST-879), and every existing entry whose `"none"` reason named this story MUST point at its dashboard uid as the Clarifications table says (apps and Railway services at their service's dashboard; queues at `motorfix-queues`; PostgreSQL and Redis at theirs; an outside service at the dashboard of the service that calls it; grafana-faro at `motorfix-web-vitals`); `web-e2e` and `openfreemap` stay `"none"` with their own reasons. `node scripts/observability-inventory.ts` MUST pass.

_From 879-dashboards._

### 879-FR-013 — The release workflow MUST push every file under the dashboards folder to Grafana Cloud through Grafana's dashboard HTTP API, overwriting by uid, after the images are built and before the staging deploy, using the secret `GRAFANA_SA_TOKEN` and the repository variable `GRAFANA_URL`; when the secret or the variable is not set the step MUST be skipped with a notice naming the missing one and the release MUST go on, as the Faro source-map steps do. A refused push MUST fail the step without printing the token.

_From 879-dashboards._

### 879-FR-014 — After each successful environment deploy (staging; production), the release MUST write one Grafana annotation tagged `deploy` and `env:<environment>` whose text is the release sha, through the same token; unset token: skipped as in FR-013.

_From 879-dashboards._

### 879-FR-015 — A dashboard check MUST run in CI's Checks job beside the inventory check and locally from the repository root, failing with the file and the rule for: invalid JSON, missing `uid` or `title`, a datasource referenced by display name or without a uid or variable, the literal `staging` or `production` in a query, title or link, no `env` variable, no `deploy` annotation, a uid no inventory entry lists, a title not starting "MotorFix", a file that is a symbolic link or holds no JSON object, or an overview with no row titled for one of the services FR-005 names. It MUST have a colocated spec with a fixture per rule and MUST pass on this repository.

_From 879-dashboards._

### 879-FR-016 — `infra/observability/README.md` MUST name the dashboards folder, the ten uids, the push and annotation steps and their secret and variable (names only), and that a change made only in Grafana's UI is overwritten by the next release.

_From 879-dashboards._

### 879-FR-017 — `libs/contracts` MUST read an optional `GRAFANA_URL` (an absolute http(s) URL; malformed → startup fails naming the variable, printing no value), listed by name in `.env.example` with a comment; unset means no link.

_From 879-dashboards._

### 879-FR-018 — The admin overview answer (`AdminOverviewDto`, the `admin.garages`-guarded endpoint) MUST gain an optional field holding the MotorFix overview dashboard URL for the API's own environment (`GRAFANA_URL` joined to the overview dashboard path with the `env` variable preselected to `APP_ENV`), present only when `GRAFANA_URL` is set; no other endpoint MUST carry it, and the generated client is regenerated from the OpenAPI document.

_From 879-dashboards._

### 879-FR-019 — The admin panel MUST show, when the field is present, one full-width link below the figure tiles and above the growth block, labelled "Observabilitate" (ro) / "Observability" (en), styled as the panel's tiles with the Cockpit tokens only, opening the URL in a new tab (`target="_blank"`, `rel="noopener noreferrer"`) with an accessible name that says it opens in a new tab; absent field → no link rendered. At 320 px nothing scrolls sideways, in light and dark.

_From 879-dashboards._

### 879-FR-020 — No Grafana credential, token or header MUST reach the browser or any response; Grafana's own sign-in protects the dashboards.

_From 879-dashboards._

### 397-FR-013 — The new endpoint MUST be listed with its telemetry in `infra/observability/inventory.json` (the API's request metrics and logs cover it; no new dashboard panel or alert, with the reason stated), as every new endpoint is.

_From 397-listing-ticks._

### 343-FR-017 — Observability: the consumer is listed in `infra/observability/inventory.json` with one counter of REQUEST_RECEIVED messages built per garage outcome (`built`, `muted`, `skipped`) and one structured log line per event with the request id and the recipient count (never the car, driver or description), the queue on the `motorfix-queues` dashboard and the counter on `motorfix-product` (the dashboards in `infra/observability/grafana/dashboards/`), and no alert (no agreed threshold; ST-880 adds alert rules); the `status` filter is one query on an existing endpoint and adds no inventory entry. The PR's Observability section names them.

_From 343-live-quote-requests._

### 374-FR-014 — Observability: every call of the four tools is counted in the existing `mcp_tool_calls_total{tool,outcome}` and `mcp_tool_call_duration_seconds{tool}` with the tool name from the catalogue (a closed set), logged as one `McpToolCall` line (tool, outcome, duration, request id; no input, no user text, no phone or plate) and traced as the `mcp.tool <name>` span; the MCP dashboard (`infra/observability/grafana/dashboards/motorfix-mcp.json`) gets a panel for the garage read tools (calls and refusals by tool, p95 by tool); the `mcp-tool-errors` alert covers them (an alert on a single tool's error rate is added only if the existing one cannot see it); `infra/observability/inventory.json` lists the four tools as a product action with their dashboard and alert, and `scripts/observability-inventory.ts` passes. (AGENTS.md observability rule; 365-FR-015)

_From 374-assistant-requests._

### 000-FR-010 — The MCP server MUST report a gauge, 1 when the identity server's discovery document at `ASSISTANT_ISSUER` answered the last probe and 0 otherwise, probed at start and then every 60 seconds, a probe not answered within 10 seconds counting as failed, no sample reported before the first answer, and carrying the same resource attributes as its other metrics; a failed probe is logged once per state change with the reason and no token or secret, and never changes how calls are answered (365-FR-003 keeps the 503 on a failed key fetch).

_From 1016-mcp-staging._

### 000-FR-011 — `infra/observability/alerts/mcp.json` MUST gain two rules on that gauge, "MCP server down" when the gauge for `deployment_environment="staging"` had samples in the last 24 hours and none in the last 5 minutes, and "identity server unreachable" when it has been 0 for 5 minutes; `motorfix-mcp` MUST gain one panel showing the gauge.

_From 1016-mcp-staging._

### 000-FR-012 — `infra/observability/inventory.json` MUST list `mcp` and `keycloak` as `railway-service` entries (`source` `scripts/railway-deploy.ts`, `dashboard` `motorfix-mcp`, `alerts` the two new uids, `story` ST-1016; the `keycloak` entry's `dashboard` is `motorfix-overview` and its alerts add `keycloak-memory`, 1178-FR-010), and `node scripts/observability-inventory.ts` MUST pass against the changed deploy script (its service discovery reads the union of every service list in the deploy script). The existing `outside-service` `keycloak` entry stays.

_From 1016-mcp-staging._

### 344-FR-018 — Observability: the endpoint is listed in `infra/observability/inventory.json` with its route duration metric; the send (a product action) MUST emit one counter of quotes sent by outcome (`sent`, `refused`, `already_answered`, `request_not_open`; `refused` counts the refusals the service raises, 400 low-above-high or past slot, 403 and 404, while a body the validation pipe refuses and a missing `Idempotency-Key` are counted by the route's own 4xx metric) and one histogram of the response time (`answered_at` − `created_at`, in minutes, no identifiers) on the `motorfix-product` dashboard; the consumer of FR-016 is listed with one counter of QUOTE_RECEIVED messages built per outcome (`built`, `muted`) on the `motorfix-queues` dashboard; one structured log line per send with the quote id, the request id and the outcome (never the range, the note or the driver); no alert (no agreed threshold; ST-880 adds alert rules). The PR's Observability section names them.

_From 344-send-quote._

### 244-FR-016 — The three operations (`POST /api/v1/consents`, `POST /api/v1/me/consents`, `GET /api/v1/me/consents`) and the outside call to Plausible MUST ship with their observability in the same PR: the request-duration metric by route for the three routes, one log line per stored record (decision, kind, signed in or not, never the browser id or the account id in clear), a counter of records by decision, a panel on the API dashboard and an entry each in `infra/observability/inventory.json` (the endpoints and the Plausible outside call, which is a browser-side call and says so as its reason), with an alert or the reason there is none.

_From 244-analytics-news-consent._

### 209-FR-014 — Observability: the consumer MUST count the messages it builds per outcome (`built`, `skipped` — no owner or no decision to tell about) in one product counter on the `motorfix-queues` dashboard, log one line per event with the file id, the decision and how many owners it reached (never the note, the address or the e-mail), run inside the worker's existing trace as its own span, and be listed in `infra/observability/inventory.json` as a queue with its counter, dashboard panel and an alert rule on the queue's final job failures; `node scripts/observability-inventory.ts` MUST pass. The PR's Observability section names them.

_From 209-status-change-emails._

### 251-FR-002 — The repo MUST hold, under `infra/observability/`, the definition of two Grafana Cloud Synthetic Monitoring HTTP checks per configured environment: Home (the environment's public web URL, expecting 200, `service=web`) and the web server's `/health/ready` (expecting 200, ready only while the API's is, `service=api`; a web outage fails it too), each every 60 s from one EU probe, with a 10 s timeout. A Jest spec MUST read the files and assert the frequency, probe count, targets and the monthly execution budget (2 checks × 43,200 = 86,400, under the free tier's 100,000).

_From 251-monitoring-backups._

### 1347-FR-003 — The repo MUST hold, under `infra/observability/alerts/`, one outage alert rule whose `service` label is named from the check's job (`motorfix-web` gives `web`; Synthetic Monitoring writes the check's own label as `label_service`), evaluated every 60 s with no pending period (`for: 0s`): a check whose `probe_success` was 0 for every run of the last 3 minutes (3 consecutive failures) fires one alert per check, labelled `outage=true` and `service` = `web` or `api`, and resolves on the first pass. The rule MUST reference only the two checks of `251-FR-002` and route to one contact point, `motorfix-outage`, which carries both the MotorFix outage webhook and the admin e-mail, declared in `contact-points.json` (`1347-FR-001`) and applied by the workflow (`1347-FR-002`), never created by hand. ST-880's threshold rules MUST NOT carry the `outage` label. `scripts/alert-rules.spec.ts` MUST fail a rule in any file under `infra/observability/alerts/` whose `notification_settings.receiver` names no `name` that `contact-points.json` declares, naming the file, the rule and the receiver, and MUST fail a fixture that renames the outage rule's receiver; `880-FR-013`'s check that an owner rule names no receiver stays beside it.

_From 1347-outage-contact-point._

### 1347-FR-004 — `infra/observability/README.md`'s "Uptime checks and the outage alert" section MUST say that the two checks are still created by hand from `uptime/checks.json`; that the contact point `motorfix-outage` (its e-mail and its webhook) and the rule `alerts/outage.json` are applied by the Grafana alerts workflow from the repository, never by hand; that the webhook integration is applied only when the repository holds the GitHub secret `OUTAGE_WEBHOOK_TOKEN` (the same value as the API's Railway variable) and the GitHub variable `STAGING_WEB_URL`, names only, set by the owner, and is otherwise skipped with a notice while the e-mail still applies; and that the admin address list on the e-mail integration is edited in `contact-points.json` when an admin joins or leaves, the next run applying it; that a changed secret or variable takes effect at the next run too (a push to a watched path, or a manual dispatch); and its opening sentence ("Set up by hand … nothing here calls its API") covers the checks only. The specs repo's `docs/how-to/back-up-and-restore-the-database.md` ("Outage alert: by-hand setup") MUST say the same in place of its by-hand step for the contact point, and `docs/how-to/set-a-secret.md` MUST name `OUTAGE_WEBHOOK_TOKEN` (GitHub secret) and `STAGING_WEB_URL` (GitHub variable); `docs-lint.mjs` checks those pages and no unit spec reads the specs repo. The README's "Alert rules" section MUST say that `contact-points.json` holds both contact points (`MotorFix owner`, e-mail to the owner's address; `motorfix-outage`, e-mail and webhook) and that the removal of hand-made duplicates keeps every uid the repository declares. `scripts/uptime-checks.spec.ts` MUST assert that the section names `uptime/checks.json`, `alerts/outage.json`, the outage rule's receiver, the workflow, `OUTAGE_WEBHOOK_TOKEN`, `STAGING_WEB_URL` and the admin list edited in `contact-points.json`, and no longer says that the contact point is created by hand, kept current by hand or that nothing here calls Grafana's API.

_From 1347-outage-contact-point._

### 251-FR-005 — The API MUST expose one endpoint that accepts Grafana's alerting webhook payload, open to visitors (`@Public()`, excluded from the OpenAPI document, so not in the public routes list; its own integration spec proves it is open to the token alone, as the Brevo webhook's is) and protected by a bearer token read from `OUTAGE_WEBHOOK_TOKEN`: the token is compared in constant time, a missing or wrong token answers 401, and when the variable is unset every call answers 401 and sends nothing. A body that is not a Grafana alerting payload answers 400 after the token check and sends nothing. The variable MUST be listed in `.env.example` by name with no value.

_From 251-monitoring-backups._

### 251-FR-006 — For each alert in the payload whose labels carry `outage=true`, the endpoint MUST send ADMIN_OUTAGE_ALERT to every active admin (an account with role `admin` and status `active`), by e-mail and push, with the state (`down` when the alert is firing, `back` when resolved), the service name and the alert's start time (firing) or end time (resolved); an alert without that label is acknowledged (204) and sends nothing. The endpoint MUST answer 204 on success and MUST NOT wait for the messages to be delivered.

_From 251-monitoring-backups._

### 251-FR-007 — One message pair per outage: the notification's event id MUST be derived from the alert's fingerprint, its start time (`startsAt`, read as one ISO time so two formats of one start give one id) and its state, so a repeated firing or resolved payload for the same outage sends nothing more (the existing uniqueness on kind, account, channel and event id), while a later outage of the same check (a new `startsAt`) is sent again.

_From 251-monitoring-backups._

### 251-FR-009 — The endpoint MUST write one structured log line per alert received (service, state, fingerprint, admin count; never the token or an address) and MUST be listed in `infra/observability/inventory.json` with its dashboard panel and its alert (or the reason for none).

_From 251-monitoring-backups._

### 251-FR-010 — The `node-app` image stage MUST start Node with source maps enabled (`NODE_OPTIONS=--enable-source-maps`), and the API, worker and MCP bundles' source maps MUST be present in the image, so a logged stack names the `.ts` source file and line. A Jest spec MUST assert the Dockerfile's runtime options and that each bundle's build emits its map; the drill of FR-015 and the staging check (one thrown error read in Grafana) are the end-to-end evidence, recorded in the runbook.

_From 251-monitoring-backups._

### 880-FR-013 — No rule of `api.json`, `worker.json`, `web.json`, `postgres.json` and `redis.json` MUST carry `notification_settings`; they are routed by the policy of FR-012. `outage.json` keeps `notification_settings.receiver` `motorfix-outage` (251-FR-003). The spec MUST fail an owner rule that names a receiver. (Replaces the receiver clause of 1024-FR-001; its other clauses hold.)

_From 880-grafana-alerts._

### 1024-FR-002 — `api.json`, `worker.json` and `web.json` MUST each hold a "down" rule (`api-down`, `worker-down`, `web-down`) that fires, per environment, when the service's `target_info{service_name="<service>"}` had samples in the last 24 hours and none in the last 5 minutes (`mcp-down`'s pattern, not pinned to an environment), `for: 0s`.

_From 1024-alert-rules._

### 1024-FR-003 — `api.json` and `web.json` MUST each hold an error-rate rule (`api-error-rate`, `web-error-rate`) that fires, per environment, when responses with status `5..` over all responses (`http_server_request_duration_seconds_count` for that `service_name`) in the last 10 minutes exceed 5 % and at least 20 responses were counted in that window, `for: 0s`. The worker answers no requests; its error arm is `worker-jobs-failed` (FR-005).

_From 1024-alert-rules._

### 1024-FR-004 — `api.json` MUST hold `api-latency` (p95 of `http_server_request_duration_seconds_bucket` for `service_name="api"` over 10 minutes above 1.5 s) and `web.json` `web-latency` (the same for `web`, above 3 s); `worker.json` MUST hold `worker-saturation` (`nodejs_eventloop_delay_p99_seconds` for `service_name="worker"` above 0.5 s); each `for: 5m`.

_From 1024-alert-rules._

### 1024-FR-005 — `worker.json` MUST hold `worker-queue-backlog`, firing per environment and queue when `motorfix_queue_oldest_waiting_seconds` exceeds 600 s for 5 minutes, and `worker-jobs-failed`, firing per environment and queue when `motorfix_jobs_total{outcome="failed"}` increased in the last 15 minutes for any queue but `verification-result` (which keeps `verification-result-failed`), `for: 0s`; both summaries name the queue (`{{ $labels.queue }}`). (Amended 2026-10-17: `worker-queue-backlog` alerts on no data (1345-FR-004).)

_From 1024-alert-rules._

### 1024-FR-006 — `postgres.json` MUST hold `postgres-unreachable` (`motorfix_datastore_up{store="postgres"}` read 0 for 5 minutes), `postgres-connections` (the sum of `motorfix_pg_connections` over `motorfix_pg_connections_max` above 80 % for 5 minutes) and `postgres-size` (`motorfix_pg_database_size_bytes` above 4 GiB for 5 minutes; the memory arm, since PostgreSQL exposes no memory figure). (Amended 2026-10-17: `postgres-unreachable` alerts on no data (1345-FR-004).)

_From 1024-alert-rules._

### 1175-FR-006 — The `redis-memory` alert MUST fire when used memory is above 70 % of the maximum (the 320 MiB floor when the server reports none) for 5 minutes, its summary saying 70 %; the `motorfix-redis` dashboard's memory panel MUST draw the 70 % line against the used-memory series, at 70 % of the 320 MiB floor (224 MiB) because a panel threshold is an absolute number; when the server reports a maximum, the alert's ratio is the authority and the line is a reference only; `infra/observability/inventory.json` MUST keep `redis-memory` on the `redis` entry and `node scripts/observability-inventory.ts` MUST pass. `redis-unreachable` and `redis-connections` stay as they are. (Amended 2026-10-17: `redis-unreachable` alerts on no data (1345-FR-004).)

_From 1175-valkey._

### 1024-FR-008 — `infra/observability/inventory.json` MUST list, in place of `"none"`: for the `app` and `railway-service` entries `api`, `worker`, `web`, that service's rule uids; for every `queue` entry with `"alerts": "none"`, `worker-queue-backlog` and `worker-jobs-failed` (the `verification-result` and `quote-timers` entries keep theirs); for `postgresql` and `redis`, their three uids; for every `outside-service` and `endpoint` entry with `"alerts": "none"` whose reason names ST-880, the error-rate and latency uids of the service that calls it (worker: `worker-jobs-failed` and `worker-saturation`) (`dashboard` tells which: `motorfix-api` → api, `motorfix-worker` → worker, `motorfix-web-vitals` and `motorfix-web` → web); every `product-counter` keeps `"none"` with the reason that a count has no failure to alert on and names the rule of the service that reports it. No `reason` MUST name ST-880 afterwards, `web-e2e` and `openfreemap` stay as they are, and `node scripts/observability-inventory.ts` MUST pass.

_From 1024-alert-rules._

### 1347-FR-002 — `.github/workflows/grafana-alerts.yml` MUST keep `infra/observability/alerts/**`, `infra/observability/grafana/alerting/**` and itself in its paths, its triggers (a push to `main` and `workflow_dispatch`, never `pull_request`, so the secret is read by runs of this workflow only), `permissions: contents: read` and its concurrency group (one run at a time, none cancelled) and, with `GRAFANA_SA_TOKEN` and `GRAFANA_URL` set (the skip notice when either is unset stays), apply in this order: every declared integration (`PUT /api/v1/provisioning/contact-points/<uid>`, `POST /api/v1/provisioning/contact-points` when the `PUT` answers 404), the policy tree (`PUT /api/v1/provisioning/policies`), every rule group as today, and last, only when every applied integration was accepted (a refused one leaves the hand-made contact point in place, so the owner is never left without a receiver), the removal of hand-made duplicates, once per declared name: `GET /api/v1/provisioning/contact-points?name=<name>` into a temporary file read with `jq`, then `DELETE /api/v1/provisioning/contact-points/<uid>` for every uid of that name the repository does not declare, so two integrations of one name never delete each other and a skipped webhook's uid is kept. A webhook integration (an entry whose `type` is `webhook`, chosen by type, never by a uid the workflow names) is applied only when the repository holds the GitHub secret `OUTAGE_WEBHOOK_TOKEN` (the API's Railway variable of the same name, `251-FR-005`) and the GitHub repository variable `STAGING_WEB_URL`, both holding a character other than a space (a token of spaces and newlines alone counts as unset, as the API's `trim()` makes it, `libs/contracts/src/env.ts:92`): then `{PUBLIC_WEB_URL}` at the start of that entry's `settings.url` is replaced by the variable with trailing slashes dropped and `settings.authorization_credentials` is set to the token with leading and trailing whitespace removed (the API reads its own variable the same way, `libs/contracts/src/env.ts`, so a secret saved with a trailing newline still matches); without either, the webhook is skipped with one `::notice::` naming what is missing (names only), not a failure, and the e-mail integrations still apply. The webhook token MUST never reach the log or a command argument, and MUST appear in the webhook integration's request body only: `jq` reads it from the step's environment into that body, which reaches `curl` on its standard input (piped by the shell's builtin `printf`), so the step writes it to no file (the design, checked by review; the specs check the arguments, the output and the bodies). Each call carries `X-Disable-Provenance: true`, the Grafana token in the `Authorization` header only, answers to `/dev/null` (the one list read per name goes to a temporary file, removed before the step ends), a 60 s timeout, one printed line per applied integration, policy and group (and one `skipped <file> (<uid>)` line per webhook not applied), a refused call named and the step failed at the end; the log MUST hold neither token nor either URL. `scripts/alert-rules.spec.ts`, `scripts/alert-rules.adversary.spec.ts` and `scripts/grafana-alerting.adversary.spec.ts` MUST keep every existing check adapted, not weakened (the e-mail entries and the policy sent verbatim; the webhook entry sent as the file's plus its url and credential), and MUST cover: both set, either missing (the notice, the e-mail applied, the group applied), the webhook's body holding the token and the address and nothing in the log holding them, the removal listing once per name and keeping every declared uid, and a skipped webhook's uid kept.

_From 1347-outage-contact-point._

### 880-FR-016 — `scripts/alert-rules.spec.ts` MUST extend ST-1024's checks to assert FR-001 to FR-005 and FR-007 to FR-014 on this repository (every rule's runbook and `for`, the `0s` table, the new rules' thresholds, windows, waits and dashboards, the no-data and failed-job assertions, the contact point, the policy and its intervals, the absence of receivers on owner rules, the workflow's order and paths), keep the 50-rule cap, and fail on a fixture that breaks each new rule (no runbook, no `for`, `0s` on a new uid, a mute interval, an unknown receiver, a receiver on an owner rule).

_From 880-grafana-alerts._

### 880-FR-015 — `infra/observability/inventory.json` MUST list `postgres-outbox-stuck` on the `postgresql` entry, `api-search-latency` on `search-garages`, `api-memory`, `worker-memory`, `web-memory` and `mcp-memory` on their service's `app` and `railway-service` entries, and `worker-queue-growing` on every entry that lists `worker-queue-backlog`; `node scripts/observability-inventory.ts` MUST pass. The README's "Alert rules" section MUST name the four new signals in its table, the runbook line, the alerting folder and its two files, that the owner rules are routed by the policy (production at once, staging quieter, no mute), and that the workflow applies the contact point and the policy before the rules.

_From 880-grafana-alerts._

### 1024-FR-012 — Nothing in this feature MUST read, print or commit a Grafana URL, token or any other value; only variable names appear. No dependency is added, and no product source under `apps/` or `libs/*/src` changes (Constitution I).

_From 1024-alert-rules._

### 880-FR-018 — The PR body's Observability section MUST list the new rules with their thresholds and the two new metrics; its Notes MUST list the owner's one step after the merge, one test firing received at the owner's address (Grafana's "Test" on the contact point, or a rule fired by hand), marked as not verifiable by the agent.

_From 880-grafana-alerts._

### 1182-FR-014 — The cache MUST be observable: one counter with one count per read kind (`profile`, `home`, `popular-brands`) and outcome — `hit`, `miss`, `stale` (served past the soft expiry), `coalesced` (a concurrent read served by another's call), `negative` (a remembered not-found or empty), `fallback` (Redis unavailable, the database answered), `purge` and `warm` — replacing `motorfix_garage_profile_cache_total`; the inventory lists it with its panel and alert or the reason none is needed; the API dashboard gains a panel with hit rate, stale serves and stampedes avoided (the `coalesced` count).

_From 1182-cache-service._

### 1169-FR-011 — The cache counter `motorfix_cache_total{kind, outcome}` MUST gain the kinds `driver-home` and `garage-home` with the outcomes `warm` (an entry stored), `hit` (an entry taken) and `miss` (a matching read found no entry), and one histogram, `motorfix_cache_warm_read_seconds{kind}`, MUST record each warm read's duration (the latency a hit saves). Metric labels and the collector's measurement carry only the kind or path and the outcome, never an account id, garage id or slug, and the skipped-warm warning names no account data. The browser MUST report each profile pre-fetch to the collector with the path `profile`, its outcome (`fetched`, `cancelled`, `hit`, `expired`, `skipped`) and, for a fetch, its duration.

_From 1169-prefetch-intent._

### 1169-FR-012 — The API dashboard (`infra/observability/grafana/dashboards/motorfix-api.json`) MUST gain one panel "Pre-fetch: warms, hits, misses, hit rate and latency saved" over the server paths, and the web-vitals dashboard one panel for the `profile` path from the collector's data. `infra/observability/alerts/api.json` MUST gain `api-prefetch-hit-rate`, firing per kind when a server path's hit rate (hits / warms) stays under 30% for 60 minutes with at least 50 warms, and `web.json` `web-prefetch-hit-rate` for the browser path by the same rule, its hit rate being `hit / fetched` (recorded as deferred, the panel standing, if the collector's data cannot be alerted on: see Assumptions); `infra/observability/inventory.json` MUST list the histogram, the two alerts and the collector's new measurement, and `scripts/observability-inventory.ts` and `scripts/alert-rules.spec.ts` MUST pass.

_From 1169-prefetch-intent._

### 1235-FR-004 — The `brands` kind MUST be counted by `motorfix_cache_total` like every other kind and named in the observability inventory.

_From 1235-unknown-brand-cache._

### 294-FR-001 — The worker MUST run a `status-checks` job every 30 seconds as a repeatable job on a `status-checks` queue, started at boot only when the `STATUS_THRESHOLDS` configuration is present and valid; absent or invalid, the job MUST NOT start and one log line MUST name the setting. Nobody triggers the job by hand, and no API route starts it.

_From 294-status-health-checks._

### 294-FR-002 — Each run MUST probe the six tiles `api`, `search`, `maps`, `email`, `notifications` and `backup` independently: a probe that throws or exceeds the 10-second probe timeout is a failed check for its tile and MUST NOT stop the run or the other probes.

_From 294-status-health-checks._

### 294-FR-003 — The probes MUST measure: `api` — the response time of `GET {PUBLIC_WEB_URL}/health/ready`, the web edge's readiness check, which is ready only while the API's is and so pings PostgreSQL, Redis and the object store, a non-200 answer being a failed check; `search` — the response time of one fixed garage search on the public address (the first popular brand, Bucharest centre) sent without the `log` flag, so no SEARCH_LOG row is written; `maps` — the response time of one geocoding call to the map provider, made on every other run (every 60 seconds, and on the first run, when the tile has no row) so the probe stays well inside the provider's free daily quota; on the runs between, the tile keeps its last check; `email` — the response time of the e-mail provider's account check (an answer other than success is a failed check), and the share of `failed` e-mail NOTIFICATION rows among those `sent` or `failed` created in the last 15 minutes; `notifications` — the age of the oldest waiting job in the `notifications` queue, and the share of `failed` push, SMS and WhatsApp NOTIFICATION rows among those `sent` or `failed` created in the last 15 minutes; `backup` — the last-modified time of the newest `<environment>/…manifest.json` key in the backup bucket (the manifest is uploaded only after the dump), with the bucket's read settings on the worker.

_From 294-status-health-checks._

### 294-FR-004 — Each probe's latency sample MUST be kept in Redis under `status:samples:{tile}` for 10 minutes, and the figure a tile is judged on (and shows as `detail.latency_ms`) MUST be the median of that tile's samples of the last 5 minutes; a failed check adds no sample. Redis holds samples only; PostgreSQL holds the state.

_From 294-status-health-checks._

### 294-FR-005 — `STATUS_THRESHOLDS` MUST be one JSON configuration value with, per tile, its amber and red limits in the tile's unit: milliseconds (`amber_ms`, `red_ms`) for `api`, `search` and `maps`; `amber_ms`/`red_ms` and a failed-send share (`amber_share`, `red_share`, 0–1) for `email`; a waiting-job age in seconds (`amber_age_s`, `red_age_s`) and a failed-send share for `notifications`; hours since the last backup (`amber_h`, `red_h`) for `backup`. No limit is hard-coded in the product code; `.env.example` MUST carry the build team's default value in full, tests MUST use fixture values, and no admin screen, API route or platform rule reads or writes it.

_From 294-status-health-checks._

### 294-FR-006 — A check's state MUST be `green` when every figure of the tile is under its amber limit, `amber` when any figure is at or over its amber limit and none at or over its red limit, and `red` when any figure is at or over its red limit or the check failed.

_From 294-status-health-checks._

### 294-FR-007 — The stored state of a tile MUST change only when two consecutive checks agree on the same new state; one differing check changes nothing. "Consecutive checks" are a tile's consecutive probes: the maps tile's are 60 seconds apart, the others' 30. The differing check's state and time are kept on the row (`pending_state`, `pending_since`) until the next check confirms or drops them. On a change, `since` MUST be set to the time of the first of those two checks. When the state does not change, `checked_at` and `detail` MUST still be updated on every run.

_From 294-status-health-checks._

### 294-FR-008 — STATUS_TILE MUST hold one row per tile: `key` (the tile), `state` (`green`, `amber`, `red`), `since`, `detail` (JSON: `latency_ms`, `failed_share`, `oldest_waiting_s`, `last_backup_at`, `reason`, as apply), `checked_at`, and the unconfirmed check's `pending_state` and `pending_since` (null when the last check agreed with `state`). The first run after the release MUST create the six rows with that run's state and `since`, and write `status_tile.changed` for each.

_From 294-status-health-checks._

### 294-FR-009 — On every state change the system MUST hand `status_tile.changed` with `{ tile, state, since }` to the event port in the same transaction as the STATUS_TILE write, and MUST NOT write it when the state is unchanged. Its audience MUST be the `admin` channel alone (the platform subject, admin only); nobody is notified by this story (the alert is #170).

_From 294-status-health-checks._

### 294-FR-010 — The six tiles' results MUST be independent: a provider that is down (Brevo, the map provider, the backup bucket) changes only its own tile; the worker's restart keeps every tile's last state.

_From 294-status-health-checks._

### 294-FR-011 — The job MUST be observable as the worker's other jobs are: counted by the jobs metric with its outcome, logged once on its final failure, listed in `infra/observability/inventory.json` with the queue, the two new outside calls (the backup bucket listing and the public-address probes) and the alert for a failed job; the dashboard panel and alert follow the existing worker-jobs ones.

_From 294-status-health-checks._

### 294-FR-012 — Tests MUST exist before the implementation and MUST cover: the two-in-a-row rule and `since` set on the first check of the new state; the 5-minute median (one sample, several, a sample older than 5 minutes left out); each tile's probe result mapped to green, amber and red with fixture limits, including a failed check and a figure exactly at a limit; the search probe writing no SEARCH_LOG row; `status_tile.changed` written in the same transaction as the tile change and only on a change, with the `admin` audience; a probe that throws not stopping the run; the job not starting on an unset or invalid `STATUS_THRESHOLDS`; the first run creating six rows; the maps probe on alternate runs and on the first; the share figure with no sends in the window. No end-to-end test in this task (#53 runs it).

_From 294-status-health-checks._
### 880-FR-001 — Every rule in every file under `infra/observability/alerts/` MUST carry an `annotations.runbook` line: one non-empty sentence naming what to check first (the panel, log or job to open), next to `summary`. `scripts/alert-rules.spec.ts` MUST fail a rule without one.

_From 880-grafana-alerts._

### 880-FR-002 — Every rule in every file MUST carry an explicit `for`. It MUST be `0s` only for the rules of this table, whose query already spans the wait; every other rule, each new rule of this story included, MUST carry a non-zero `for`, and the spec MUST fail a rule with `for: 0s` whose uid is not in the table.

_From 880-grafana-alerts._

### 880-FR-003 — `api-error-rate` MUST keep 5 % of responses over 10 minutes with the 20-response guard and `api-latency` 1.5 s at p95 (1024-FR-003, 1024-FR-004); the spec asserts the thresholds unchanged.

_From 880-grafana-alerts._

### 880-FR-004 — `postgres.json` MUST gain `postgres-outbox-stuck`: fires per environment when `max by (deployment_environment) (motorfix_outbox_oldest_pending_seconds)` is above 60, `for: 5m`, `dashboard_uid` `motorfix-postgres`, the summary naming the environment.

_From 880-grafana-alerts._

### 880-FR-005 — `api.json` MUST gain `api-search-latency`: fires per environment when the p95 of `http_server_request_duration_seconds_bucket{service_name="api", http_route="/api/v1/search/garages"}` over 5 minutes is above 0.3 s, `for: 10m`, `dashboard_uid` `motorfix-api`; the `motorfix-api` dashboard MUST gain a panel drawing that p95 per environment with a 300 ms threshold line (#1219's panel).

_From 880-grafana-alerts._

### 880-FR-006 — The shared telemetry setup in `libs/observability` MUST observe, for every service that starts it (api, worker, web, mcp), the process's resident memory (`process.memory.usage`, unit bytes) and its container memory limit (`motorfix_process_memory_limit_bytes`, read from the kernel's cgroup limit, v2 then v1); when the limit is `max`, 2^62 bytes or more (cgroup v1's unlimited value) or unreadable, the limit is not observed at all. A colocated Jest spec asserts both readings and the unlimited case.

_From 880-grafana-alerts._

### 880-FR-007 — `api.json`, `worker.json`, `web.json` and `mcp.json` MUST each gain a memory rule (`api-memory`, `worker-memory`, `web-memory`, `mcp-memory`): fires per environment when `max by (deployment_environment) (process_memory_usage_bytes{service_name="<svc>"} / on (deployment_environment, instance) motorfix_process_memory_limit_bytes{service_name="<svc>"})` is above 0.85, `for: 10m`, `dashboard_uid` the service's dashboard; the `motorfix-overview` dashboard MUST gain one panel drawing each service's share of its limit with an 85 % threshold line.

_From 880-grafana-alerts._

### 880-FR-008 — The spec MUST assert that the no-data rules `api-down`, `web-down`, `worker-down` and `mcp-down` exist and that each one's title and summary name its service; no new no-data rule is added.

_From 880-grafana-alerts._

### 880-FR-009 — `worker.json` MUST gain `worker-queue-growing`: fires per environment and queue when `max by (deployment_environment, queue) (delta(motorfix_queue_waiting[5m]))` is above 0, `for: 15m`, `dashboard_uid` `motorfix-worker`, the summary naming the queue (`{{ $labels.queue }}`).

_From 880-grafana-alerts._

### 880-FR-010 — The spec MUST assert that `worker-jobs-failed` exists and fires on `motorfix_jobs_total{outcome="failed"}`, the counter of final failures only, so "a scheduled job that failed for good" is covered; no new rule is added.

_From 880-grafana-alerts._

### 1347-FR-001 — `infra/observability/grafana/alerting/contact-points.json` MUST declare exactly three entries, each one integration in Grafana's provisioning form (`uid`, `name`, `type`, `settings`): `MotorFix owner`, uid `motorfix-owner`, one e-mail integration whose addresses hold the owner's address and nothing else, unchanged; and under the name `motorfix-outage`, which together form the one contact point the outage rule names, an e-mail integration, uid `motorfix-outage-email`, whose addresses hold the admin address list (the owner's address, the only admin today), and a webhook integration, uid `motorfix-outage-webhook`, whose settings are `url` `{PUBLIC_WEB_URL}/api/v1/monitoring/outage-alerts` (the placeholder `infra/observability/uptime/checks.json` uses), `httpMethod` `POST` and `authorization_scheme` `Bearer`, and no other key. No other entry, name or integration type: `MotorFix owner` stays e-mail only. No integration sets `disableResolveMessage` (it is no permitted key), so Grafana sends each resolution too and the API can turn it into `back` (`251-FR-006`). An e-mail integration's `addresses` is one string of e-mail addresses separated by `;` (Grafana's form): `MotorFix owner`'s is the owner's address alone; the outage e-mail's holds the owner's address and any further admin's, so an admin who joins or leaves is a one-line edit of the file. The alerting files MUST hold no credential (`authorization_credentials` or any other secret setting), no host (no `://` in any value) and no key beyond `uid`, `name`, `type`, `settings` and those settings. `scripts/alert-rules.spec.ts` MUST assert `MotorFix owner` and the webhook entry as written and the outage e-mail's shape, and fail a fixture that adds `authorization_credentials`, a host in the webhook's url, an unknown key, an array of addresses, a fourth entry or a second integration type under `MotorFix owner`.

_From 1347-outage-contact-point._

### 880-FR-012 — `infra/observability/grafana/alerting/policies.json` MUST declare the notification policy tree: root receiver `MotorFix owner`, grouped by alert name and environment, with the production intervals (group wait 30 s, group interval 5 m, repeat 4 h) set explicitly; a route matched on `deployment_environment = production` to `MotorFix owner` (group wait 30 s, group interval 5 m, repeat 4 h) and a route matched on `deployment_environment = staging` to `MotorFix owner` with longer intervals (group wait 5 m, group interval 30 m, repeat 24 h). No route, the root included, MUST hold `mute_time_intervals` or `active_time_intervals`; the spec MUST fail on one, and on a route naming a receiver the contact-point file does not declare.

_From 880-grafana-alerts._

### 880-FR-017 — Every new rule MUST follow the file's existing shape (1024-FR-001: uid and title prefixed by the service, `condition` `B`, `noDataState: OK`, `execErrState: Error`, the `service` label, a summary naming the environment, query `A` on `grafanacloud-prom` grouped by environment, no `outage` label, no environment named in a query), and every metric a rule names MUST be drawn by a dashboard under `infra/observability/grafana/dashboards/`. (Amended 2026-10-17: `noDataState: OK` except the three absence rules, which alert on no data (1345-FR-004).)

_From 880-grafana-alerts._

### 297-FR-001 — The system MUST keep a System status log table, SYSTEM_LOG_ENTRY, owned by the `admin` module, with: `id`, `at` (timestamptz, the time of the event), `source`, `severity` ∈ {`info`, `warning`, `error`}, `kind`, `message` (English text), `context` (JSON), `fingerprint` (the grouping key within kind and source), `minute` (the minute of `at`, for grouping) and `count` (≥ 1). Indexes: `(at desc)`, `(kind, at)`, a unique index on `(kind, source, fingerprint, minute)`, and a text index on `message` for #171's search.

_From 297-system-status-log._

### 297-FR-002 — `kind` MUST be one of `status_changed`, `check_failed`, `job_failed`, `service_error`, `server_error`, `backup_completed`, `backup_failed`, `deploy`; `source` MUST be one of the tile keys `api`, `search`, `maps`, `email`, `notifications`, `backup`, plus `worker`, `webrtc`, `identity`, `storage`. Any other value MUST be refused by the writer and never stored.

_From 297-system-status-log._

### 297-FR-003 — There MUST be one writer, `systemLog.write()`, in the domain library, usable by the API and the worker; every entry of this story MUST go through it. It MUST scrub `message`, `fingerprint` and every string in `context` (e-mail addresses, Romanian phone numbers, Romanian plates → `***`), set `at` to now when the caller gives none, derive `minute` from `at`, and then either insert a new row with `count` 1 or, when a row with the same `(kind, source, fingerprint, minute)` exists, increment that row's `count` and leave its other fields as first written. The insert-or-increment MUST be one atomic statement, so two instances writing the same key in the same instant produce one row with the summed count, never two rows or a failed write. `message` is built from the kind and the context only (never an error's free text), and `context` carries ids, codes and figures only, each reason string already bounded where it is made.

_From 297-system-status-log._

### 297-FR-004 — The writer MUST run outside any business transaction: it MUST NOT take part in the caller's transaction, a rollback of the caller's work MUST NOT remove the entry, and a failed write MUST NOT fail the caller. On a failed write the entry is dropped, one error is logged to the server error reporting (the structured error log and trace ST-251 set up) with the kind and source but never the entry's text, and nothing retries it. A request or a provider call never waits for the write (the API's filter and the Brevo and Geoapify paths do not await it), so a slow database cannot hold an answer; a `write()` called before the writer has started or after it has stopped MUST be dropped the same way (counted `dropped`), never throw.

_From 297-system-status-log._

### 299-FR-019 — After a new row is inserted (not on an increment), the System status log writer MUST publish `system_log.added` with `{ id, kind, at, entryKind, severity, source }` (the entry's kind, severity and source) on the live channel for the `admin` audience only, straight to Redis with no outbox row; a failed publish MUST be logged and MUST NOT fail the write or the caller. A Jest test reads the published message and its three new fields; Jurnal's re-read on the event is unchanged.

_From 299-system-log-search._

### 297-FR-006 — The status checks (ST-294) MUST write, on each confirmed tile state change, after the tiles' own transaction has committed (never inside it, FR-004), `status_changed` with source the tile key, severity `warning` for `amber` and `red` and `info` for `green`, fingerprint the new state, context `{ state, latency_ms | failed_share | oldest_waiting_s | last_backup_at | reason, as the tile's detail holds }`; and, on each failed check (a probe that throws or times out), `check_failed` with source the tile key, severity `warning`, fingerprint the reason, context `{ reason }`.

_From 297-system-status-log._

### 297-FR-007 — The worker MUST write `job_failed` (severity `error`, source `worker`) when a job fails for good (its last attempt, or an unrecoverable error), on every queue the worker runs (a queue with its own failed-listener, such as the listing photos, goes through the same final-failure hook), with context `{ queue, job, attempts, error_code }` where `error_code` is the error's `code` when it has one, else its class name, and fingerprint `queue:job:error_code`; a failure that will be retried writes nothing.

_From 297-system-status-log._

### 297-FR-008 — Outside-service errors MUST be written as `service_error` (severity `error`) when the e-mail, SMS and WhatsApp provider (Brevo) refuses or fails a call (source `email` for an e-mail send, `notifications` for an SMS or WhatsApp send) and when the map provider (Geoapify) answers an error or is unreachable (source `maps`), with fingerprint the provider's status or reason and context `{ provider, status | reason }`. Only the product's own calls write it: the status probes' calls to the same providers write `check_failed` (FR-006), never `service_error`. Every provider error thrown writes one, retried attempts included; grouping absorbs the retries. A refusal that is the platform's own rule (the SMS cap, a missing template) is not a provider error. No personal field of the call (recipient, number, address text) MUST reach the entry.

_From 297-system-status-log._

### 297-FR-009 — The API MUST write `server_error` (severity `error`, source `api`) for every 500 answer caused by an unexpected error (not for `HttpException`s, 4xx problems or the oversized-body refusal), with fingerprint the route template (`METHOD /route/:param`, `unknown` when none matched) and context `{ method, route }` (the route with the API's global prefix, as `openapi.json` names it); the write MUST NOT delay or change the error answer.

_From 297-system-status-log._

### 297-FR-010 — The backup entries MUST be derived from the backup bucket the status checks already read: `backup_completed` (severity `info`, source `backup`, fingerprint the manifest's time, context `{ backup_at }`) when the newest manifest's time is newer than the last `backup_completed` entry's; `backup_failed` (severity `error`, source `backup`, fingerprint the day, context `{ last_backup_at, reason }`) when the `backup` tile changes to `amber` or `red` because the last backup is older than its limit, once per change. The backup workflow itself is not changed.

_From 297-system-status-log._

### 297-FR-011 — The worker MUST write `deploy` (severity `info`, source `worker`, fingerprint the version, context `{ version }`) at boot when the release version is set (not `dev`) and the newest `deploy` entry's version differs from it; the same version MUST NOT be logged twice however many instances boot.

_From 297-system-status-log._

### 297-FR-012 — A nightly purge MUST run at 03:30 Europe/Bucharest, once per night across every worker instance (one repeatable job under a fixed scheduler id with the cron pattern `30 3 * * *` in Europe/Bucharest, as the insights snapshot is scheduled), and delete every entry whose `at` is older than 90 days (OD-33); it MUST log how many rows it deleted and be observable like the worker's other jobs. The retention period is a constant of the build, not a setting.

_From 297-system-status-log._

### 297-FR-013 — Nothing in this story MUST write a System status log entry for a change a person makes in the app (a price-list update, a reported review, a document submission, an account change); those are the audit history's. No audit history row MUST be written for a log entry.

_From 297-system-status-log._

### 297-FR-014 — The new table, the writer's counter (`motorfix_system_log_entries_total` by `kind` and `outcome` ∈ `written`, `grouped`, `dropped`), the purge job and the live publish MUST be listed in `infra/observability/inventory.json` in the same change, with the purge's failure alerted like the worker's other jobs.

_From 297-system-status-log._

### 297-FR-015 — Tests MUST exist before the implementation and MUST cover: each source writing one entry with the right kind, source and severity (tile change, failed check, final job failure, Brevo and Geoapify errors, server error, backup completed and failed, deploy); grouping within a minute (40 → count 40) and across a minute boundary (two rows); the scrubber masking an e-mail, a phone and a plate in `message` and in `context`; a failed write not failing the caller and being reported once; the write surviving the caller's rollback; `system_log.added` on the `admin` audience only, on insert and not on increment, and a failed publish not failing the write; the purge deleting a 91-day entry and keeping an 89-day one; a retried job failure writing nothing; a business change (price list, reported review) writing no entry; a refused kind or source. No end-to-end test in this task (#55 runs it).

_From 297-system-status-log._
### 1345-FR-001 — The Node runtime instrumentation of the api, worker, web and mcp MUST sample the event-loop delay at the library's default resolution (10 ms), never at a precision of a second or more, so that `nodejs_eventloop_delay_p99_seconds` on an idle process reads below 0.05 s and the `worker-saturation` rule (0.5 s for 5 minutes) fires only on a stall; the panels and the rule are unchanged. A test asserts the configured precision.

_From 1345-staging-observability._

### 1345-FR-002 — When telemetry is on and the worker starts its datastore readings with `MONITOR_DATABASE_URL` unset, it MUST emit exactly one WARN record through the OTel log pipeline and one `"level":"warn"` JSON line on stdout, naming the variable and that PostgreSQL readings are off; with the variable set, nothing is logged. The record MUST print no value of any variable.

_From 1345-staging-observability._

### 1345-FR-004 — In `infra/observability/alerts/`, the rules `postgres-unreachable`, `redis-unreachable` and `worker-queue-backlog` MUST carry `noDataState: Alerting`; every other rule MUST keep `noDataState: OK`; `execErrState` is unchanged. `scripts/alert-rules.spec.ts` asserts the value per rule uid, and the README's alert table says which rules alert on missing data.

_From 1345-staging-observability._

### 1345-FR-005 — When the web server starts with telemetry on (OTLP endpoint set) and `FARO_URL` unset, it MUST emit exactly one WARN record through the OTel log pipeline and one `warn` JSON line saying browser telemetry is off because `FARO_URL` is unset; with telemetry off, or `FARO_URL` set, nothing is logged. Owner step, out of code scope: set `FARO_URL` on the staging web service.

_From 1345-staging-observability._

### 1345-FR-008 — The server request-duration histogram (`http.server.request.duration`) of the api and of the web MUST hold no sample for the long-lived event streams, `GET /api/v1/live` and `GET /api/v1/live/public`, on either server (the web proxies them under `/api`), matched on the request path alone, so a query string (the public stream takes one) does not change the match; every other request is recorded as before. The p95 queries in the dashboards and the `api-latency` and `web-latency` rules are unchanged. `instrumentations.spec.ts` asserts a stream records no histogram sample and a plain request does.

_From 1345-staging-observability._

### 1345-FR-009 — Every failure the web's `/api/` proxy reports MUST carry the request's method and its path without the query string, masked as every log line is, on both the stdout line and the OTel record.

_From 1345-staging-observability._

### 1345-FR-010 — A proxy failure after the response started (headers sent, including an upstream response that closes before it is complete) MUST be reported once at WARN, not ERROR, and the visitor's response closed; no 502 is written. A failure the proxy causes itself, by destroying the upstream because the visitor left, MUST be neither retried nor logged above INFO.

_From 1345-staging-observability._

### 1345-FR-011 — A GET or HEAD whose upstream request raised an error before any byte of the response arrived (a connection reset, a hang up or a refusal; the proxy sets no upstream timeout), while the visitor is still waiting, MUST be sent once more on a fresh connection, at most once (the event streams included); a second failure, or the failure of any other method, MUST be reported at ERROR and answered 502, as today. The proxy specs cover each branch.

_From 1345-staging-observability._

### 280-FR-023 — Restates `1345-FR-012` with a larger instance cap: when telemetry is on, the api and the worker MUST, once their meter provider is registered, initialise every product counter they emit at 0 for each label combination its code can emit (the `motorfix_*_total` counters of `libs/domain/src/metrics/product-counters.ts`, `quotes.metrics.ts` and `garage-search.metrics.ts`, each label from its closed set: an `outcome` from its union, a decline `reason` from `DECLINE_REASON_CODES`, an e-mail `template` per registered template), each process only the counters its own modules record (the API's `motorfix_support_messages_total{outcome}` and the worker's `motorfix_support_emails_total{kind,outcome}` included), within the caps `product-counters.spec.ts` asserts (under 50 series per counter, under 150 per instance), so each panel shows 0 instead of "No data"; a later action adds 1 to the matching series. With telemetry off the initialisation is a no-op (879-FR-011). A test with a metrics reader asserts the 0 data points and that the counts still increment.

_From 280-contact-motorfix._

### 1345-FR-015 — Every Error % panel (the `motorfix-api`, `motorfix-web`, `motorfix-worker` and `motorfix-mcp` dashboards and the four service rows of `motorfix-overview`) MUST show 0 when no failure was counted in a window that holds requests (a 5xx response; for the overview's worker row, which reads jobs, a failed job, `motorfix_jobs_total{outcome="failed"}`) and the share otherwise; the numerator is `(sum(rate(…)) or vector(0))` over the label-free sums the panels use today, and a window with no request (or job) at all stays "No data". `scripts/observability-config.spec.ts` asserts the expressions.

_From 1345-staging-observability._

### 1345-FR-018 — The admin accounts failure log MUST log a 401 at info, with the same route and status fields, and every other status of 400 or above at warn. A colocated test asserts the level per status.

_From 1345-staging-observability._

### 1348-FR-006 — A cache read that fills an entry (the lead of a miss, inside a warm or not) MUST count its outcome (`miss`, or `warm` inside a warm, 1169-FR-011) as soon as its read function has answered and before the entry is sent to Redis, so that an entry found in Redis always has its count recorded; the counted outcome does not depend on the store's answer (as before this change, when the count followed the store whether or not it succeeded), so the meaning of `warm` and `miss` is unchanged and only the order moves; a background refresh of a stale entry still counts nothing. A cache service integration test MUST observe the counter at the moment the store is sent and fail while the count follows the store; `home-warm.integration.spec.ts` then passes every time, with no retry, sleep or wait added to it.

_From 1348-release-green._
### 173-FR-014 — The two new endpoints MUST be listed in `infra/observability/inventory.json` with their metrics (the API's route metrics), logs, the dashboard panel and alert they fall under, or the reason they need none, and the PR's Observability section names them (`scripts/observability-inventory.ts` fails CI on one left out).

_From 173-price-range-in-place._

### 1178-FR-005 — The worker MUST accept one new optional setting naming Keycloak's metrics endpoint (`KEYCLOAK_METRICS_URL`, a full address to the management interface's `/metrics` on Railway's private network). When it is unset or empty, the worker MUST make no request to any metrics endpoint and publish no Keycloak sample; every other reading is unchanged.

_From 1178-keycloak-sizing._

### 1178-FR-006 — When the setting is set, the worker's data-store readings MUST read the endpoint once a minute with the other stores (the first read at start, not awaited by the boot, each read given up after 5 s, never two at once) and publish two gauges, `motorfix_keycloak_heap_used_bytes` (the sum of `jvm_memory_used_bytes{area="heap"}` over its pools) and `motorfix_keycloak_heap_max_bytes` (the sum of the non-negative `jvm_memory_max_bytes{area="heap"}` values), plus `motorfix_datastore_up{store="keycloak"}`.

_From 1178-keycloak-sizing._

### 1178-FR-007 — A read that fails (no answer within the limit, a non-2xx status, or a body without a heap-used series and a positive heap maximum) MUST publish no heap sample for that reading (never zero), MUST set `motorfix_datastore_up{store="keycloak"}` to 0, MUST NOT affect the PostgreSQL, Redis or outbox readings, and MUST be logged as one error line per failure streak naming the reason and never the address's credentials or the body.

_From 1178-keycloak-sizing._

### 1178-FR-008 — The `motorfix-overview` dashboard MUST gain a `keycloak` row with one panel showing Keycloak heap used against heap maximum for the selected environment, following the rules `scripts/dashboard-check.ts` enforces (environment variable, data source through a variable).

_From 1178-keycloak-sizing._

### 1178-FR-009 — A new rule group `infra/observability/alerts/keycloak.json` MUST hold a rule with uid `keycloak-memory`, service label `keycloak`, grouped by `deployment_environment`, pending 10 minutes while heap used divided by heap maximum stays above 0.9, with a summary naming the environment, `dashboard_uid` `motorfix-overview` and a `runbook` annotation (raise the Railway limit; read Keycloak's logs; look for session or cache growth), raising nothing when no sample arrives. It MUST pass `scripts/alert-rules.spec.ts`.

_From 1178-keycloak-sizing._

### 1178-FR-010 — `infra/observability/inventory.json`'s `keycloak` railway-service entry MUST list `keycloak-memory`, its dashboard MUST become `motorfix-overview` (where the heap panel is), and its reason MUST name the worker's reading as the memory signal; the outside-service `keycloak` entry is unchanged. `scripts/observability-inventory.ts` MUST pass.

_From 1178-keycloak-sizing._

### 1178-FR-012 — The two gauges carry no label of their own; the environment and service come from the worker's OpenTelemetry resource attributes, as for every other data-store figure, so the existing environment filters select them.

_From 1178-keycloak-sizing._

## Retired

- `881-FR-003` — superseded by `924-FR-001` (2026-10-08)

- `875-FR-007` — superseded by `879-FR-016` (2026-10-08)
- `881-FR-002` — superseded by `879-FR-012` (2026-10-08)

- `879-FR-010` — superseded by `244-FR-018` (2026-10-10)

- `879-FR-010` — superseded by `251-FR-018` (2026-10-10)

- `1024-FR-007` — superseded by `1175-FR-006` (2026-10-15)

- `1024-FR-001` — superseded by `880-FR-013` (2026-10-17)
- `1024-FR-009` — superseded by `880-FR-014` (2026-10-17)
- `1024-FR-011` — superseded by `880-FR-015` (2026-10-17)
- `1024-FR-010` — superseded by `880-FR-016` (2026-10-17)
- `1024-FR-013` — superseded by `880-FR-018` (2026-10-17)
- `880-FR-011` — superseded by `1347-FR-001` (2026-10-17)
- `880-FR-014` — superseded by `1347-FR-002` (2026-10-17)
- `251-FR-003` — superseded by `1347-FR-003` (2026-10-17)
- `251-FR-004` — superseded by `1347-FR-004` (2026-10-17)

- `1345-FR-012` — superseded by `280-FR-023` (2026-10-17)

- `297-FR-005` — superseded by `299-FR-019` (2026-10-17)
