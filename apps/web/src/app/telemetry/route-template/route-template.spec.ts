import type { Route } from '@angular/router';

import { routeTemplate } from './route-template';

interface Node {
  routeConfig: Route | null;
  firstChild: Node | null;
}

// The router state's root has no route of its own; each matched route
// hangs below it as the first child of the one before.
function matched(...configs: Route[]): Node {
  return {
    firstChild: configs.reduceRight<Node | null>(
      (child, routeConfig) => ({ firstChild: child, routeConfig }),
      null,
    ),
    routeConfig: null,
  };
}

describe('routeTemplate', () => {
  it('joins the configured paths from the root, keeping parameters', () => {
    expect(
      routeTemplate(
        matched({ path: ':lang' }, { path: 'reset-password/:token' }),
      ),
    ).toBe('/:lang/reset-password/:token');
  });

  it('lets a route matched by a matcher add nothing', () => {
    expect(
      routeTemplate(matched({ path: ':lang' }, { matcher: () => null })),
    ).toBe('/:lang');
  });

  it('names the root /', () => {
    expect(routeTemplate(matched({ path: '' }, { path: '' }))).toBe('/');
  });

  it('skips empty paths between named ones', () => {
    expect(
      routeTemplate(
        matched({ path: 'app/driver' }, { path: '' }, { path: 'cars/:car' }),
      ),
    ).toBe('/app/driver/cars/:car');
  });

  it('names the catch-all route unmatched', () => {
    expect(routeTemplate(matched({ path: '**' }))).toBe('unmatched');
  });

  it('names a state with no matched route unmatched', () => {
    expect(routeTemplate(matched())).toBe('unmatched');
    expect(routeTemplate(null)).toBe('unmatched');
  });
});
