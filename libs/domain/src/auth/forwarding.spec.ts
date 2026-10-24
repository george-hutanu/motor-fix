import { forwardingFields } from './forwarding';

const SOCKET = 'fd12:3456:789a::1';

describe('forwardingFields', () => {
  // @traces 500-FR-012
  it('lists every forwarded hop left to right, then the socket, each masked', () => {
    expect(
      forwardingFields({
        headers: { 'x-forwarded-for': '86.125.92.213, 95.173.10.20' },
        socket: SOCKET,
      }),
    ).toBe(
      'hops=86.125.x.x,95.173.x.x,fd12:3456:x:x:x:x:x:x headers=x-forwarded-for',
    );
  });

  // @traces 500-FR-012
  it('masks an IPv6 hop and an IPv4-mapped hop as the caller is masked', () => {
    expect(
      forwardingFields({
        headers: {
          'x-forwarded-for': '2a02:2f0c:1234:5678::9, ::ffff:86.125.1.2',
        },
        socket: '::ffff:10.0.0.5',
      }),
    ).toBe(
      'hops=2a02:2f0c:x:x:x:x:x:x,86.125.x.x,10.0.x.x headers=x-forwarded-for',
    );
  });

  // @traces 500-FR-012
  it('shows a forged entry masked too, never as written', () => {
    expect(
      forwardingFields({
        headers: { 'x-forwarded-for': 'spoof, 1.2.3.4, 86.125.92.213' },
        socket: SOCKET,
      }),
    ).toBe(
      'hops=unknown,1.2.x.x,86.125.x.x,fd12:3456:x:x:x:x:x:x headers=x-forwarded-for',
    );
  });

  // @traces 500-FR-012
  it('is the socket alone without a forwarded-for header, and unknown without a socket', () => {
    expect(forwardingFields({ headers: {}, socket: '95.173.10.20' })).toBe(
      'hops=95.173.x.x headers=none',
    );
    expect(forwardingFields({ headers: {}, socket: undefined })).toBe(
      'hops=unknown headers=none',
    );
  });

  // @traces 500-FR-012
  it('keeps the rightmost 8 hops of a long chain and counts the rest', () => {
    const chain = Array.from({ length: 300 }, (_, i) => `9.${i % 250}.1.1`);
    const fields = forwardingFields({
      headers: { 'x-forwarded-for': chain.join(', ') },
      socket: SOCKET,
    });

    const hops = fields.split(' ')[0]?.slice('hops='.length).split(',');
    expect(hops?.[0]).toBe('+292');
    expect(hops).toHaveLength(1 + 8 + 1);
    expect(hops?.slice(1, 9)).toEqual(
      chain.slice(-8).map((a) => `${a.split('.', 2).join('.')}.x.x`),
    );
  });

  // @traces 500-FR-012
  it('reads a header sent twice as one chain', () => {
    expect(
      forwardingFields({
        headers: { 'x-forwarded-for': ['86.125.92.213', '95.173.10.20'] },
        socket: SOCKET,
      }),
    ).toBe(
      'hops=86.125.x.x,95.173.x.x,fd12:3456:x:x:x:x:x:x headers=x-forwarded-for',
    );
  });

  // @traces 500-FR-013
  it('names the forwarding headers present, sorted and once, never their values', () => {
    const fields = forwardingFields({
      headers: {
        accept: 'text/html',
        'cdn-clientip': '86.125.92.213',
        'cf-connecting-ip': '86.125.92.214',
        cookie: 'mf_refresh=secret',
        forwarded: 'for=86.125.92.215',
        'true-client-ip': '86.125.92.216',
        via: '1.1 railway-edge',
        'x-envoy-external-address': '86.125.92.217',
        'x-forwarded-for': '86.125.92.218',
        'x-forwarded-host': 'web-staging.example',
        'x-forwarded-proto': 'https',
        'x-railway-edge': 'europe-west4',
        'x-real-ip': '86.125.92.219',
        'x-something-ip': '86.125.92.220',
      },
      socket: SOCKET,
    });

    expect(fields).toContain(
      ' headers=cdn-clientip,cf-connecting-ip,forwarded,true-client-ip,via,x-envoy-external-address,x-forwarded-for,x-forwarded-host,x-forwarded-proto,x-railway-edge,x-real-ip,x-something-ip',
    );
    expect(fields).not.toMatch(
      /accept|cookie|secret|railway-edge |europe|https|staging/,
    );
  });

  // @traces 500-FR-013
  it('never lists a name that could carry an address, nor more than 16 names', () => {
    const many = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [
        `x-${String.fromCharCode(97 + (i % 26))}${'z'.repeat(i)}-ip`,
        '1',
      ]),
    );
    const fields = forwardingFields({
      headers: {
        ...many,
        'x-81.196.222.173-ip': '1',
        'x-a1-ip': '1',
        [`x-${'a'.repeat(40)}-ip`]: '1',
      },
      socket: SOCKET,
    });

    const names = fields.split(' headers=')[1]?.split(' ')[0]?.split(',');
    expect(names).toHaveLength(16);
    expect(fields).not.toMatch(/222|173|a1-ip|a{40}/);
  });

  // @traces 500-FR-014
  it('records x-real-ip and the for= values of Forwarded, masked', () => {
    expect(
      forwardingFields({
        headers: {
          forwarded:
            'for="[2a02:2f0c::1]:4711";proto=https, For=86.125.92.213:8080;by=10.0.0.1, for=_hidden, proto=http',
          'x-real-ip': '86.125.92.213',
        },
        socket: SOCKET,
      }),
    ).toBe(
      'hops=fd12:3456:x:x:x:x:x:x headers=forwarded,x-real-ip real-ip=86.125.x.x forwarded=2a02:2f0c:x:x:x:x:x:x,86.125.x.x,unknown,unknown',
    );
  });

  // @traces 500-FR-014
  it('leaves real-ip and forwarded out when those headers are absent', () => {
    const fields = forwardingFields({
      headers: { 'x-forwarded-for': '86.125.92.213' },
      socket: SOCKET,
    });

    expect(fields).not.toContain('real-ip=');
    expect(fields).not.toContain('forwarded=');
  });

  // @traces 500-FR-011
  it('never lets a full address of the request through', () => {
    const addresses = [
      '86.125.92.213',
      '95.173.10.20',
      '2a02:2f0c:abcd:ef01:2345:6789:abcd:ef01',
      '100.64.33.44',
    ];
    const fields = forwardingFields({
      headers: {
        forwarded: `for=${addresses[0]}, for="[${addresses[2]}]"`,
        'x-forwarded-for': addresses.join(', '),
        'x-real-ip': `${addresses[1]}, ${addresses[3]}`,
      },
      socket: '::ffff:100.64.55.66',
    });

    for (const address of [...addresses, '100.64.55.66'])
      expect(fields).not.toContain(address);
    expect(fields).not.toMatch(/\.92\.|\.213|\.10\.20|abcd|ef01|\.33\.|\.55\./);
  });
});
