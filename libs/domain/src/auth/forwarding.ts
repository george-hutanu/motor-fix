import type { IncomingHttpHeaders } from 'node:http';

import { maskCaller } from './attempts';

// What a request said about the way it came: its headers and the address of
// the socket it arrived on.
export interface Forwarding {
  headers: IncomingHttpHeaders;
  socket: string | undefined;
}

const MAX_ENTRIES = 8;
const MAX_NAMES = 16;
const MAX_NAME_LENGTH = 40;

// A name of letters and hyphens only, so no name can carry an address.
const NAME = /^[a-z-]+$/;
const FORWARDING_NAMES = new Set([
  'cdn-clientip',
  'cf-connecting-ip',
  'fastly-client-ip',
  'forwarded',
  'true-client-ip',
  'via',
  'x-client-ip',
  'x-cluster-client-ip',
  'x-real-ip',
]);
const FORWARDING_NAME = /^(?:x-forwarded-|x-railway-|x-envoy-)|-ip$|clientip$/;

const entries = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value.join(',') : (value ?? ''))
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

// The rightmost entries, masked, after the count of those left out.
const masked = (list: string[]) => {
  const kept = list.slice(-MAX_ENTRIES).map(maskCaller);
  const dropped = list.length - kept.length;
  return (dropped > 0 ? [`+${dropped}`, ...kept] : kept).join(',');
};

// The address a Forwarded element's for= names: quotes, IPv6 brackets and a
// port taken off. An obfuscated or missing one is no address.
function forOf(element: string): string {
  const pair = element
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.toLowerCase().startsWith('for='));
  const value = (pair?.slice('for='.length) ?? '').replace(/^"|"$/g, '');
  if (value.startsWith('[')) return value.slice(1, value.indexOf(']'));
  const [host, port, ...rest] = value.split(':');
  return port !== undefined && rest.length === 0 ? (host ?? '') : value;
}

const names = (headers: IncomingHttpHeaders) =>
  Object.keys(headers)
    .map((name) => name.toLowerCase())
    .filter(
      (name, i, all) =>
        all.indexOf(name) === i &&
        name.length <= MAX_NAME_LENGTH &&
        NAME.test(name) &&
        (FORWARDING_NAMES.has(name) || FORWARDING_NAME.test(name)),
    )
    .sort()
    .slice(0, MAX_NAMES);

// The forwarding facts of a refused sign-in as log tokens: every forwarded
// hop then the socket, the forwarding header names (never their values), and
// x-real-ip and Forwarded's for= when sent. Every address masked as the
// caller is, so none reaches a log whole.
export function forwardingFields({ headers, socket }: Forwarding): string {
  const hops = [
    masked(entries(headers['x-forwarded-for'])),
    maskCaller(socket ?? ''),
  ];
  const listed = names(headers);
  const fields = [
    `hops=${hops.filter(Boolean).join(',')}`,
    `headers=${listed.length ? listed.join(',') : 'none'}`,
  ];
  if (headers['x-real-ip'] !== undefined)
    fields.push(`real-ip=${masked(entries(headers['x-real-ip']))}`);
  if (headers.forwarded !== undefined)
    fields.push(`forwarded=${masked(entries(headers.forwarded).map(forOf))}`);
  return fields.join(' ');
}
