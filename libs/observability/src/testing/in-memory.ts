import type { InstrumentationModuleDefinition } from '@opentelemetry/instrumentation';
import { InMemoryLogRecordExporter } from '@opentelemetry/sdk-logs';
import { MetricReader } from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-node';

import { startedInstrumentations } from '../setup/start';
import { gaugeDelta } from '../setup/temporality';

class ManualMetricReader extends MetricReader {
  constructor() {
    super({ aggregationTemporalitySelector: gaugeDelta });
  }
  protected override async onForceFlush() {}
  protected override async onShutdown() {}
}

// Exporters that keep everything in memory, passed to startTelemetry by
// specs in place of the OTLP ones.
export function inMemory() {
  return {
    logExporter: new InMemoryLogRecordExporter(),
    metricReader: new ManualMetricReader(),
    spanExporter: new InMemorySpanExporter(),
  };
}

// Jest loads modules through its own registry, which the instrumentations'
// require hooks never see: apply their patches to the modules Jest loaded.
// Call after startTelemetry and before the app is built.
export function patchForJest(): void {
  for (const instrumentation of startedInstrumentations()) {
    const definitions =
      (
        instrumentation as unknown as {
          getModuleDefinitions?: () => InstrumentationModuleDefinition[];
        }
      ).getModuleDefinitions?.() ?? [];
    for (const definition of definitions) {
      if (!definition.patch) continue;
      let exports: unknown;
      try {
        exports = require(definition.name);
      } catch {
        continue;
      }
      const version = moduleVersion(definition.name);
      definition.patch(exports, version);
    }
  }
}

function moduleVersion(name: string): string | undefined {
  if (!name.includes('/') && require('node:module').isBuiltin(name)) {
    return process.versions.node;
  }
  try {
    return (require(`${name}/package.json`) as { version: string }).version;
  } catch {
    return undefined;
  }
}
