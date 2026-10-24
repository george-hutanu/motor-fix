import { BlockList, isIP } from 'node:net';

// The hops Railway and our own services connect from: loopback, link-local,
// RFC 1918, Railway's internal proxy (100.64.0.0/10) and fc00::/7. BlockList
// reads an IPv4-mapped IPv6 hop as its IPv4 address; only an address in
// dotted or colon form (isIP) is matched, so `2130706433` or `0x7f.0.0.1` is
// never read as loopback.
const PRIVATE = new BlockList();
for (const [net, bits] of [
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['100.64.0.0', 10],
] as const) {
  PRIVATE.addSubnet(net, bits, 'ipv4');
}
for (const [net, bits] of [
  ['::1', 128],
  ['fe80::', 10],
  ['fc00::', 7],
] as const) {
  PRIVATE.addSubnet(net, bits, 'ipv6');
}

function isPrivate(addr: string): boolean {
  const kind = isIP(addr);
  return kind !== 0 && PRIVATE.check(addr, kind === 4 ? 'ipv4' : 'ipv6');
}

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
  if (isPrivate(addr)) return true;
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
  pastPublic ||= trusted && !isPrivate(addr);
  next = trusted ? i + 1 : -1;
  return trusted;
}
