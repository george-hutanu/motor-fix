import { KEYCLOAK_LIMIT_MS, parseKeycloakMetrics } from './keycloak';
import { KEYCLOAK_LIMIT_MS as exported } from '../index';

// What Keycloak 26.8's management /metrics serves for the heap, as read
// from the running image (G1: only the old generation carries a maximum).
const HEAP = [
  '# HELP jvm_memory_used_bytes The amount of used memory',
  '# TYPE jvm_memory_used_bytes gauge',
  'jvm_memory_used_bytes{area="heap",id="G1 Eden Space"} 2.4117248E7',
  'jvm_memory_used_bytes{area="heap",id="G1 Survivor Space"} 1.4230336E7',
  'jvm_memory_used_bytes{area="heap",id="G1 Old Gen"} 6.417468E7',
  'jvm_memory_used_bytes{area="nonheap",id="Metaspace"} 1.2E8',
  '# TYPE jvm_memory_max_bytes gauge',
  'jvm_memory_max_bytes{area="heap",id="G1 Eden Space"} -1.0',
  'jvm_memory_max_bytes{area="heap",id="G1 Survivor Space"} -1.0',
  'jvm_memory_max_bytes{area="heap",id="G1 Old Gen"} 9.98244352E8',
  'jvm_memory_max_bytes{area="nonheap",id="Metaspace"} 2.68435456E8',
  'jvm_threads_live_threads 42.0',
].join('\n');

// @traces 1178-FR-006
// @traces 1178-FR-007
describe('parseKeycloakMetrics', () => {
  it('sums the heap pools used, and the heap maxima that are not negative', () => {
    expect(parseKeycloakMetrics(HEAP)).toEqual({
      heapMaxBytes: 998_244_352,
      heapUsedBytes: 24_117_248 + 14_230_336 + 64_174_680,
    });
  });

  it('reads the heap area whatever the label order', () => {
    const text = [
      'jvm_memory_used_bytes{id="G1 Old Gen",area="heap"} 100',
      'jvm_memory_max_bytes{id="G1 Old Gen",area="heap"} 1000',
    ].join('\n');

    expect(parseKeycloakMetrics(text)).toEqual({
      heapMaxBytes: 1000,
      heapUsedBytes: 100,
    });
  });

  it('accepts a heap in use of 0', () => {
    const text = [
      'jvm_memory_used_bytes{area="heap",id="G1 Old Gen"} 0.0',
      'jvm_memory_max_bytes{area="heap",id="G1 Old Gen"} 1000',
    ].join('\n');

    expect(parseKeycloakMetrics(text).heapUsedBytes).toBe(0);
  });

  it('leaves out maxima that are not finite', () => {
    const text = [
      'jvm_memory_used_bytes{area="heap",id="G1 Old Gen"} 10',
      'jvm_memory_max_bytes{area="heap",id="a"} NaN',
      'jvm_memory_max_bytes{area="heap",id="b"} +Inf',
      'jvm_memory_max_bytes{area="heap",id="c"} 500',
    ].join('\n');

    expect(parseKeycloakMetrics(text).heapMaxBytes).toBe(500);
  });

  it('fails a body with no heap in use, and says nothing of the body', () => {
    const text =
      'jvm_memory_max_bytes{area="heap",id="G1 Old Gen"} 1000\nsecret-ish';

    expect(() => parseKeycloakMetrics(text)).toThrow(
      new Error('no heap series'),
    );
  });

  it('fails a body whose heap has no positive maximum', () => {
    const text = [
      'jvm_memory_used_bytes{area="heap",id="G1 Old Gen"} 10',
      'jvm_memory_max_bytes{area="heap",id="G1 Eden Space"} -1.0',
    ].join('\n');

    expect(() => parseKeycloakMetrics(text)).toThrow(
      new Error('no positive heap maximum'),
    );
  });

  it('fails a body that is not Prometheus text', () => {
    expect(() => parseKeycloakMetrics('<html>Not found</html>')).toThrow(
      new Error('no heap series'),
    );
  });
});

describe('KEYCLOAK_LIMIT_MS', () => {
  it('is the one 5 s limit of a Keycloak reading, exported for the worker', () => {
    expect(KEYCLOAK_LIMIT_MS).toBe(5_000);
    expect(exported).toBe(KEYCLOAK_LIMIT_MS);
  });
});
