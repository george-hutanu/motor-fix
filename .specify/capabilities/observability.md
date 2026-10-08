---
capability: observability
updated: 2026-10-07
features:
  - 875-observability-stack
  - 876-otel-instrumentation
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
