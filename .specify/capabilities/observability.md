---
capability: observability
updated: 2026-10-08
features:
  - 875-observability-stack
  - 876-otel-instrumentation
  - 881-observability-current
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

### 881-FR-003 — One check script, `scripts/observability-inventory.ts`, MUST discover from the code, without reading any environment variable: every directory under `apps/`; every service name in `scripts/railway-deploy.ts`; every queue name from `new Queue(…)`, `registerQueue(…)` and an outbox consumer's `queue:` in non-test, non-generated source under `libs/` and `apps/`, resolving a name given as an exported constant; every outside host literal (`https://<host>`, except hosts under the reserved TLDs `.example`, `.test`, `.invalid`, `.localhost`) and every known SDK client (`S3Client`, `web-push`) in the same files; `libs/data-access/`, `libs/domain/src/generated/`, `*.spec.ts`, `*.testing.ts` and test stubs are not scanned. A `new Queue(<identifier>)` whose identifier is not an exported string constant is skipped. Product counters, PostgreSQL and Redis are hand-listed, not discovered. It MUST fail (non-zero exit) naming each discovered item the inventory does not list (kind, name, file) and each stale inventory entry (a discovered kind the check no longer discovers, or a hand-listed entry whose `source` path no longer exists); `--root <dir>` runs it against another tree; with nothing wrong it MUST print one summary line and exit zero.

_From 881-observability-current._

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
