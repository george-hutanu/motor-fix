---
capability: observability
updated: 2026-10-08
features:
  - 875-observability-stack
  - 876-otel-instrumentation
  - 881-observability-current
  - 915-telemetry-flush-on-stop
  - 924-inventory-real-calls
  - 877-web-health-grafana
  - 916-otlp-log-masking-coverage
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

### 875-FR-007 — `infra/observability/README.md` MUST state where dashboards and alert rules live as code, the Grafana Cloud free-tier limits, the expected usage, the 20% production trace sampling, the low-cardinality rule for metric labels (no user, request or record ids as labels) and the $0 cost.

_From 875-observability-stack._

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

### 876-FR-008 — The API MUST report a request-duration histogram (the OTel instrument `http.server.request.duration`) labelled by route template, method and status, sufficient to derive request rate, error rate and duration per route.

_From 876-otel-instrumentation._

### 876-FR-009 — The worker MUST report `motorfix_jobs_total` by queue, job name and outcome and `motorfix_job_duration_seconds` by queue and job name, and, for every queue the worker opens, `motorfix_queue_waiting`, `motorfix_queue_oldest_waiting_seconds` and `motorfix_queue_failed_total` by queue, read every 15 s.

_From 876-otel-instrumentation._

### 876-FR-010 — The API, worker and MCP MUST report the Node runtime metrics (event-loop lag, heap, garbage collection, CPU).

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

### 881-FR-002 — The inventory committed by this feature MUST list what the code holds today: apps `api`, `mcp`, `web`, `web-e2e`, `worker`; Railway services `api`, `worker`, `web`; queues `insights`, `reminders`, `notifications`, `news`; outside services Brevo (e-mail, `api.brevo.com`), the S3 object store, the Web Push service, Google sign-in (`accounts.google.com`), Apple sign-in (`appleid.apple.com`), PostgreSQL and Redis; product counters: none yet (the worker's job and queue metrics and the runtime metrics from 876-FR-009/010 are listed under their apps, not as product counters); endpoint count equal to the operation count of `apps/api/openapi.json` at merge (63 at specification time). Every entry says `"none"` for dashboard and alerts with the reason that ST-879 (dashboards) and ST-880 (alerts) add them.

_From 881-observability-current._

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

### 877-FR-004 — The web server MUST report the request-duration histogram (`http.server.request.duration`) labelled by route template, method and status, and the Node runtime metrics, with labels from small fixed sets only (876-FR-008, -010, -011).

_From 877-web-health-grafana._

### 877-FR-005 — The web server's log lines MUST carry the trace id and span id when one is active; a request ending in a server error MUST write one error log line with the trace id and mark the span as error; e-mails, Romanian phone numbers and plates MUST be masked in spans, logs and exceptions (876-FR-006, -007, -012).

_From 877-web-health-grafana._

### 877-FR-006 — `/health/ready` on the web server MUST answer ok only when the API's `/health/ready` answers any 2xx within 2 s; otherwise it MUST answer 503. Each probe MUST call the API once; no result is cached. `/health/live` MUST stay unconditional.

_From 877-web-health-grafana._

### 877-FR-007 — The web server MUST read the browser collector URL from its runtime configuration (one optional variable, proposed `FARO_URL`, an absolute https URL in staging and production) and hand it, with the release version, to the browser inside the HTML it renders (no new endpoint); unset or empty → no browser telemetry and no telemetry code loaded in the browser. A malformed value MUST fail at start naming the variable and never print its value. `.env.example` MUST list the variable by name with no value.

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

## Retired

- `881-FR-003` — superseded by `924-FR-001` (2026-10-08)
