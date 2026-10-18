// Keycloak's heap, read from the Prometheus text its management /metrics
// serves (Micrometer's jvm_memory_* series).
export interface KeycloakReading {
  heapUsedBytes: number;
  heapMaxBytes: number;
}

const SAMPLE = /^jvm_memory_(used|max)_bytes\{([^}]*)\}\s+(\S+)(?:\s+\d+)?\s*$/;

// The heap samples of the body, as [kind, value]: the area="heap" series
// whatever the label order, with a value that is a finite number of 0 or more.
function heapSamples(text: string): ['used' | 'max', number][] {
  return text.split('\n').flatMap((line) => {
    const [, kind, labels = '', raw] = SAMPLE.exec(line.trim()) ?? [];
    const value = Number(raw);
    const heap = /(?:^|,)\s*area="heap"/.test(labels);
    return heap && Number.isFinite(value) && value >= 0
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
  if (max <= 0) throw new Error('no positive heap maximum');
  return { heapMaxBytes: max, heapUsedBytes: sum('used') };
}
