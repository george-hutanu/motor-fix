import { isIP } from 'node:net';

import proxyaddr from 'proxy-addr';

// The hops Railway and our own services connect from: loopback, link-local,
// RFC 1918 and fc00::/7 ("uniquelocal"), and Railway's internal proxy in
// 100.64.0.0/10. proxy-addr's matcher reads an IPv4-mapped IPv6 hop as its
// IPv4 address and an entry that is not an address as no match.
const isPrivate = proxyaddr.compile([
  'loopback',
  'linklocal',
  'uniquelocal',
  '100.64.0.0/10',
]);

/**
 * Whether Express may look past hop `i` (0 is the socket, then X-Forwarded-For
 * from the right), given whether a public hop was already trusted on this walk.
 * A private hop is trusted until a public one is; exactly one public hop, the
 * edge PoP whose range Railway varies by region, is trusted when a private hop
 * sits right of it. Never two public hops, so a client-written entry left of
 * the PoP is never passed.
 */
export function trustsHop(
  addr: string,
  i: number,
  pastPublic: boolean,
): boolean {
  if (pastPublic) return false;
  if (isPrivate(addr, i)) return true;
  return i > 0 && isIP(addr) !== 0;
}

// Express calls the trust function once per hop of one walk, i = 0, 1, … in
// order, synchronously, and stops at the first false (proxy-addr's alladdrs),
// so the walk's state lives here between those calls. A call out of order
// trusts nothing.
let next = 0;
let pastPublic = false;

/** The `trust proxy` function the API sets: trustsHop over one walk. */
export function trustProxy(addr: string, i: number): boolean {
  if (i === 0) pastPublic = false;
  else if (i !== next) {
    next = -1;
    return false;
  }
  const trusted = trustsHop(addr, i, pastPublic);
  pastPublic ||= trusted && !isPrivate(addr, i);
  next = trusted ? i + 1 : -1;
  return trusted;
}
