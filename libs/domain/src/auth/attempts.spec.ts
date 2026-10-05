import { clientOf } from './attempts';

describe('one client however its address is written', () => {
  it.each([
    ['an IPv4 address', '198.51.100.7', '198.51.100.7'],
    ['its IPv4-mapped form', '::ffff:198.51.100.7', '198.51.100.7'],
    ['its IPv4-mapped form in hex', '::ffff:c633:6407', '198.51.100.7'],
    ['an IPv6 address in capitals', '2001:DB8::ABCD', '2001:db8:0:0::/64'],
    ['the same, written out', '2001:db8:0:0:0:0:0:abcd', '2001:db8:0:0::/64'],
    ['another host of that /64', '2001:db8::1:2:3:4', '2001:db8:0:0::/64'],
    ['an address with a zone id', 'fe80::1%eth0', 'fe80:0:0:0::/64'],
  ])('keys %s', (_, address, client) => {
    expect(clientOf(address)).toBe(client);
  });

  it.each([
    ['no address at all', ''],
    ['something that is no address', 'not-an-address'],
    ['an IPv4 address out of range', '999.1.1.1'],
    ['a zone id alone', '%eth0'],
  ])('has no client for %s', (_, address) => {
    expect(clientOf(address)).toBeNull();
  });
});
