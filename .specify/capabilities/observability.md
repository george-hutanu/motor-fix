---
capability: observability
updated: 2026-10-07
features:
  - 875-observability-stack
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
