import { scrubDeep } from '@motor-fix/observability';

import { maskCaller } from './attempts';

const GRAMMAR =
  /^(\d{1,3}\.\d{1,3}\.x\.x|[0-9a-f]{1,4}:[0-9a-f]{1,4}(:x){6}|unknown)$/;

// @traces 500-FR-001 500-FR-002 500-FR-003 500-FR-004 500-FR-007
describe('masking a caller address that is odd', () => {
  it.each([
    [
      'an IPv6 address with an embedded IPv4 tail',
      '2a02:2f0c:1:2:3:4:81.196.1.2',
      '2a02:2f0c:x:x:x:x:x:x',
    ],
    ['a NAT64 address', '64:ff9b::81.196.1.2', '64:ff9b:x:x:x:x:x:x'],
    ['an IPv4-mapped address in capitals', '::FFFF:81.196.1.2', '81.196.x.x'],
    [
      'an IPv4-mapped address written in full',
      '0:0:0:0:0:ffff:81.196.1.2',
      '81.196.x.x',
    ],
    [
      'an IPv4-mapped address with a zone id',
      '::ffff:81.196.1.2%eth0',
      '81.196.x.x',
    ],
    [
      'an IPv4-mapped address in hex with capitals',
      '::FFFF:51C4:102',
      '81.196.x.x',
    ],
    ['the unspecified IPv6 address', '::', '0:0:x:x:x:x:x:x'],
    ['the unspecified IPv4 address', '0.0.0.0', '0.0.x.x'],
    ['the IPv4 loopback', '127.0.0.1', '127.0.x.x'],
    [
      'an IPv6 address with a numeric zone id',
      'fe80::1%2',
      'fe80:0:x:x:x:x:x:x',
    ],
    [
      'an IPv6 address with a zone id holding a percent sign',
      'fe80::1%a%b',
      'fe80:0:x:x:x:x:x:x',
    ],
    [
      'an address ending in a lone zone separator',
      'fe80::1%',
      'fe80:0:x:x:x:x:x:x',
    ],
    [
      'an IPv6 address with a trailing compression',
      '2a02:2f0c::',
      '2a02:2f0c:x:x:x:x:x:x',
    ],
    [
      'an IPv6 address with a compression in the middle',
      '2a02:2f0c::5:6',
      '2a02:2f0c:x:x:x:x:x:x',
    ],
  ])('masks %s', (_, address, masked) => {
    expect(maskCaller(address)).toBe(masked);
  });

  it.each([
    ['an octet above 255', '256.1.1.1'],
    ['an IPv4 address with an out-of-range last octet', '81.196.1.999'],
    ['a negative octet', '81.-1.1.1'],
    ['a hex octet', '0x51.196.1.2'],
    ['an octet padded with a zero', '081.196.1.2'],
    ['a trailing dot', '81.196.1.2.'],
    ['a trailing newline', '81.196.1.2\n'],
    [
      'an address followed by an injected log line',
      '81.196.1.2\nsign-in refused: invalid_credentials caller=1.2.x.x',
    ],
    ['a tab', '81.196.1.2\t'],
    ['a NUL byte', '81.196.1.2\u0000'],
    ['full-width digits', '８１.１９６.１.２'],
    ['Arabic-Indic digits', '٨١.١٩٦.١.٢'],
    ['an IPv6 address in brackets', '[2a02:2f0c::1]'],
    ['an IPv6 address with a port', '[2a02:2f0c::1]:443'],
    ['an IPv6 address with a prefix length', '2a02:2f0c::/32'],
    ['an IPv4 address with a prefix length', '81.196.1.2/16'],
    ['two compressions', '2a02::2f0c::1'],
    ['nine groups', '1:2:3:4:5:6:7:8:9'],
    ['a group of five digits', '12345::1'],
    ['a group that is not hex', 'g::1'],
    ['a zone id alone', '%eth0'],
    ['only whitespace', '   '],
    ['an e-mail address', 'visitor@example.com'],
    ['a host name', 'example.com'],
    ['a comma-separated chain', '81.196.1.2, 10.0.0.1'],
    ['the word unknown', 'unknown'],
    ['a mask already applied', '81.196.x.x'],
  ])('names %s unknown', (_, address) => {
    expect(maskCaller(address)).toBe('unknown');
  });

  it('names a megabyte of garbage unknown without echoing it', () => {
    const huge = 'a'.repeat(1_000_000);
    expect(maskCaller(huge)).toBe('unknown');
    expect(maskCaller(`${'1:'.repeat(500_000)}1`)).toBe('unknown');
    expect(maskCaller(`81.196.1.2${' '.repeat(1_000_000)}`)).toBe('unknown');
  });

  it('never lets any octet or group past the second reach the result', () => {
    expect(maskCaller('81.196.222.173')).not.toMatch(/222|173/);
    expect(maskCaller('2a02:2f0c:abcd:ef01:2345:6789:abcd:ef01')).not.toMatch(
      /abcd|ef01|2345|6789/,
    );
    expect(maskCaller('::ffff:81.196.222.173')).not.toMatch(/222|173/);
  });

  it('gives the same answer when asked twice', () => {
    for (const address of ['81.196.1.2', '2a02::1', 'junk', '']) {
      expect(maskCaller(address)).toBe(maskCaller(address));
    }
  });

  it('always answers inside the documented grammar and unchanged by the scrubber', () => {
    const inputs = [
      '81.196.1.2',
      '2a02:2f0c::1',
      '::',
      '::1',
      '::ffff:1.2.3.4',
      '64:ff9b::1.2.3.4',
      'fe80::1%eth0',
      'FE80::ABCD',
      '1.2.3',
      '1.2.3.4.5',
      '\u0000',
      '😀',
      'x:x:x:x:x:x:x:x',
      'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
      '255.255.255.255',
    ];
    for (const address of inputs) {
      const masked = maskCaller(address);
      expect(masked).toMatch(GRAMMAR);
      expect(scrubDeep(masked)).toBe(masked);
    }
  });
});
