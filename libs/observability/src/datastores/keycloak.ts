// Keycloak's heap, read from the Prometheus text its management /metrics
// serves (Micrometer's jvm_memory_* series).

// How long one reading of Keycloak's /metrics may take: the worker's fetch
// and the poller's limit both use it.
export const KEYCLOAK_LIMIT_MS = 5_000;

export interface KeycloakReading {
  heapUsedBytes: number;
  heapMaxBytes: number;
}

// A sample line: the name, its labels (a quoted value may hold a brace),
// the value, an optional timestamp and an optional OpenMetrics exemplar.
const SAMPLE =
  /^jvm_memory_(used|max)_bytes\{((?:[^"}]|"(?:[^"\\]|\\.)*")*)\}\s+(\S+)(?:\s+-?\d+)?(?:\s*#.*)?$/;
const LABEL = /(\w+)\s*=\s*"((?:[^"\\]|\\.)*)"/g;
// A plain decimal number, as Prometheus writes it; no hex, no separators.
const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

const isHeap = (labels: string) =>
  [...labels.matchAll(LABEL)].some(
    ([, name, value]) => name === 'area' && value === 'heap',
  );

// The heap samples of the body, as [kind, value]: the area="heap" series
// whatever the label order, with a decimal value of 0 or more.
function heapSamples(text: string): ['used' | 'max', number][] {
  return text.split('\n').flatMap((line) => {
    const [, kind, labels = '', raw = ''] = SAMPLE.exec(line.trim()) ?? [];
    const value = DECIMAL.test(raw) ? Number(raw) : Number.NaN;
    return kind && isHeap(labels) && Number.isFinite(value) && value >= 0
      ? [[kind as 'used' | 'max', value]]
      : [];
  });
}

// The heap in use, summed over its pools, and the heap's maximum, summed
// over the pools that have one: under G1 the young pools report -1, which
// is left out. Throws when the body holds neither, saying nothing of it.
export function parseKeycloakMetrics(text: string): KeycloakReading {
  const samples = heapSamples(text);
  const sum = (kind: 'used' | 'max') =>
    samples.filter(([k]) => k === kind).reduce((total, [, v]) => total + v, 0);
  if (!samples.some(([kind]) => kind === 'used'))
    throw new Error('no heap series');
  const max = sum('max');
  const used = sum('used');
  if (max <= 0) throw new Error('no positive heap maximum');
  if (!Number.isFinite(max) || !Number.isFinite(used))
    throw new Error('heap sum out of range');
  return { heapMaxBytes: max, heapUsedBytes: used };
}
