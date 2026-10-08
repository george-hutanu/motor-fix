import type { Route } from '@angular/router';

import { routeTemplate } from './route-template';

interface Node {
  routeConfig: Route | null;
  firstChild: Node | null;
}

function matched(...configs: Route[]): Node {
  return {
    firstChild: configs.reduceRight<Node | null>(
      (child, routeConfig) => ({ firstChild: child, routeConfig }),
      null,
    ),
    routeConfig: null,
  };
}

describe('routeTemplate under odd router states', () => {
  it('names a root with no child unmatched', () => {
    expect(routeTemplate({ firstChild: null, routeConfig: null })).toBe(
      'unmatched',
    );
  });

  it('names a null state unmatched', () => {
    expect(routeTemplate(null as never)).toBe('unmatched');
  });

  it('names a wildcard at any depth unmatched', () => {
    expect(
      routeTemplate(matched({ path: ':lang' }, { path: 'a' }, { path: '**' })),
    ).toBe('unmatched');
    expect(routeTemplate(matched({ path: '**' }))).toBe('unmatched');
  });

  it('never leaks the concrete URL segments', () => {
    const template = routeTemplate(
      matched({ path: ':lang' }, { path: 'garages/:id' }),
    );

    expect(template).toBe('/:lang/garages/:id');
  });

  it('does not double slashes for empty paths between configured ones', () => {
    expect(
      routeTemplate(matched({ path: ':lang' }, { path: '' }, { path: 'x' })),
    ).toBe('/:lang/x');
  });

  it('handles a route with neither path nor matcher', () => {
    expect(routeTemplate(matched({ path: ':lang' }, {}))).toBe('/:lang');
  });

  it('survives a very deep chain', () => {
    const chain = Array.from({ length: 5000 }, () => ({ path: 'a' }));

    expect(routeTemplate(matched(...chain))).toBe(`/${'a/'.repeat(4999)}a`);
  });

  it('returns the same answer for the same state twice', () => {
    const state = matched({ path: ':lang' }, { path: 'x/:id' });

    expect(routeTemplate(state)).toBe(routeTemplate(state));
  });
});
