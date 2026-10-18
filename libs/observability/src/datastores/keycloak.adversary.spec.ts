import { parseKeycloakMetrics } from './keycloak';

const used = (labels: string, value: string) =>
  `jvm_memory_used_bytes{${labels}} ${value}`;
const max = (labels: string, value: string) =>
  `jvm_memory_max_bytes{${labels}} ${value}`;
const HEAP = 'area="heap",id="G1 Old Gen"';

// @traces 1178-FR-006
describe('parseKeycloakMetrics on hostile Prometheus text', () => {
  it('reads a body with CRLF line ends', () => {
    const body = `${[used(HEAP, '5.0E7'), max(HEAP, '1.0E9')].join('\r\n')}\r\n`;
    expect(parseKeycloakMetrics(body)).toEqual({
      heapMaxBytes: 1e9,
      heapUsedBytes: 5e7,
    });
  });

  it('reads samples that carry a timestamp', () => {
    const body = [
      used(HEAP, '5.0E7 1700000000000'),
      max(HEAP, '1.0E9 1700000000000'),
    ].join('\n');
    expect(parseKeycloakMetrics(body)).toEqual({
      heapMaxBytes: 1e9,
      heapUsedBytes: 5e7,
    });
  });

  it('reads samples that carry an OpenMetrics exemplar', () => {
    const body = [
      `${used(HEAP, '5.0E7')} # {trace_id="abc"} 1.0 1700000000`,
      `${max(HEAP, '1.0E9')} # {trace_id="abc"} 1.0`,
    ].join('\n');
    expect(parseKeycloakMetrics(body)).toEqual({
      heapMaxBytes: 1e9,
      heapUsedBytes: 5e7,
    });
  });

  it('reads a leading byte-order mark, tabs and padding around a sample', () => {
    const body = `﻿${used(HEAP, '10')}\n\t  ${max(HEAP, '\t100  ')}  \n`;
    expect(parseKeycloakMetrics(body)).toEqual({
      heapMaxBytes: 100,
      heapUsedBytes: 10,
    });
  });

  it('does not take area="heapx", area="nonheap" or a prefixed name for the heap', () => {
    const body = [
      used('area="heapx",id="a"', '999'),
      used('area="nonheap",id="Metaspace"', '999'),
      used('area="Heap",id="a"', '999'),
      'xjvm_memory_used_bytes{area="heap"} 999',
      'jvm_memory_used_bytes_total{area="heap"} 999',
      'jvm_memory_committed_bytes{area="heap"} 999',
      used(HEAP, '7'),
      max('area="heapx"', '5000'),
      max(HEAP, '70'),
    ].join('\n');
    expect(parseKeycloakMetrics(body)).toEqual({
      heapMaxBytes: 70,
      heapUsedBytes: 7,
    });
  });

  it('ignores area="heap" quoted inside another label value', () => {
    const body = [
      used('area="nonheap",id="x, area=\\"heap\\""', '999'),
      used('id="y",note="area=heap",area="nonheap"', '999'),
      used(HEAP, '7'),
      max(HEAP, '70'),
    ].join('\n');
    expect(parseKeycloakMetrics(body)).toEqual({
      heapMaxBytes: 70,
      heapUsedBytes: 7,
    });
  });

  it('reads a heap sample whose label value contains a closing brace', () => {
    const body = [
      used('area="heap",id="pool}x"', '7'),
      max('area="heap",id="pool}x"', '70'),
    ].join('\n');
    expect(parseKeycloakMetrics(body)).toEqual({
      heapMaxBytes: 70,
      heapUsedBytes: 7,
    });
  });

  it('reads the heap label in any position and with spaces after commas', () => {
    const body = [
      used('id="a", area="heap"', '1'),
      used('id="b",area="heap",x="y"', '2'),
      max('id="a" , area="heap"', '30'),
      max('area="heap"', '40'),
    ].join('\n');
    expect(parseKeycloakMetrics(body)).toEqual({
      heapMaxBytes: 70,
      heapUsedBytes: 3,
    });
  });

  it.each([
    ['2.4117248E7', 24117248],
    ['2.4117248e+7', 24117248],
    ['1e3', 1000],
    ['0', 0],
  ])('reads the value %s', (raw, expected) => {
    const body = [used(HEAP, raw), max(HEAP, '100')].join('\n');
    expect(parseKeycloakMetrics(body).heapUsedBytes).toBe(expected);
  });

  it.each(['NaN', '+Inf', 'Inf', 'Infinity', '0x10', '1_000', '--5'])(
    'does not count the non-decimal value %s as used bytes',
    (raw) => {
      const body = [
        used(HEAP, raw),
        used('area="heap",id="b"', '3'),
        max(HEAP, '100'),
      ].join('\n');
      expect(parseKeycloakMetrics(body).heapUsedBytes).toBe(3);
    },
  );

  it('does not add a negative used value to the sum', () => {
    const body = [
      used(HEAP, '-5.0E7'),
      used('area="heap",id="b"', '100'),
      max(HEAP, '1000'),
    ].join('\n');
    expect(parseKeycloakMetrics(body).heapUsedBytes).toBe(100);
  });

  it('reports used 0 for a heap that holds nothing', () => {
    const body = [used(HEAP, '0.0'), max(HEAP, '1000')].join('\n');
    expect(parseKeycloakMetrics(body)).toEqual({
      heapMaxBytes: 1000,
      heapUsedBytes: 0,
    });
  });

  it('leaves -1 maxima out and sums the rest, with a duplicate pool counted twice', () => {
    const body = [
      used(HEAP, '1'),
      used(HEAP, '1'),
      max('area="heap",id="Eden"', '-1.0'),
      max(HEAP, '50'),
      max(HEAP, '50'),
    ].join('\n');
    expect(parseKeycloakMetrics(body)).toEqual({
      heapMaxBytes: 100,
      heapUsedBytes: 2,
    });
  });

  it('ignores commented lines that look like samples', () => {
    const body = [
      `# ${used(HEAP, '999')}`,
      `# HELP jvm_memory_max_bytes ${max(HEAP, '999')}`,
      used(HEAP, '1'),
      max(HEAP, '10'),
    ].join('\n');
    expect(parseKeycloakMetrics(body)).toEqual({
      heapMaxBytes: 10,
      heapUsedBytes: 1,
    });
  });
});

// @traces 1178-FR-007
describe('parseKeycloakMetrics on bodies that are failed readings', () => {
  it.each([
    ['empty', '', 'no heap series'],
    ['only whitespace', ' \r\n\t\n', 'no heap series'],
    [
      'an HTML error page',
      '<html><body>502 Bad Gateway</body></html>',
      'no heap series',
    ],
    ['only another family', 'jvm_threads_live_threads 42.0', 'no heap series'],
    [
      'only non-heap used',
      used('area="nonheap",id="Metaspace"', '5'),
      'no heap series',
    ],
    ['used with no max', used(HEAP, '5'), 'no positive heap maximum'],
    ['max with no used', max(HEAP, '5'), 'no heap series'],
    [
      'only -1 maxima',
      [used(HEAP, '5'), max(HEAP, '-1.0')].join('\n'),
      'no positive heap maximum',
    ],
    [
      'a zero maximum',
      [used(HEAP, '5'), max(HEAP, '0.0')].join('\n'),
      'no positive heap maximum',
    ],
    [
      'a NaN maximum',
      [used(HEAP, '5'), max(HEAP, 'NaN')].join('\n'),
      'no positive heap maximum',
    ],
    [
      'an infinite maximum',
      [used(HEAP, '5'), max(HEAP, '+Inf')].join('\n'),
      'no positive heap maximum',
    ],
  ])('throws for %s', (_, body, message) => {
    expect(() => parseKeycloakMetrics(body)).toThrow(new Error(message));
  });

  it('names neither the body nor its values in the error', () => {
    const body = `secret-token-123\n${used(HEAP, '5')}\n${max(HEAP, '0')}`;
    let message = '';
    try {
      parseKeycloakMetrics(body);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe('no positive heap maximum');
  });

  it('throws rather than reporting an infinite maximum when sums overflow', () => {
    const body = [
      used(HEAP, '1'),
      max(HEAP, '1.7E308'),
      max('area="heap",id="b"', '1.7E308'),
    ].join('\n');
    expect(() => parseKeycloakMetrics(body)).toThrow(
      new Error('heap sum out of range'),
    );
  });

  it('reads a ten-thousand-pool body in well under a second', () => {
    const lines: string[] = [];
    for (let i = 0; i < 10_000; i += 1) {
      lines.push(used(`area="heap",id="p${i}"`, '1'));
      lines.push(max(`area="heap",id="p${i}"`, '2'));
      lines.push(`other_family{id="p${i}"} 1`);
    }
    const started = Date.now();
    expect(parseKeycloakMetrics(lines.join('\n'))).toEqual({
      heapMaxBytes: 20_000,
      heapUsedBytes: 10_000,
    });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('stays linear on a long line of padding', () => {
    const started = Date.now();
    expect(() =>
      parseKeycloakMetrics(
        `jvm_memory_used_bytes{area="heap"} ${' '.repeat(200_000)}x`,
      ),
    ).toThrow(new Error('no heap series'));
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
