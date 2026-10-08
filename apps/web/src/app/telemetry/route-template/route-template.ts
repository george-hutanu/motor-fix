import type { Route } from '@angular/router';

interface RouteNode {
  routeConfig: Route | null;
  firstChild: RouteNode | null;
}

// The route template a page was matched by (`/:lang/garages/:garage`), never
// its URL: telemetry groups by it and a URL can carry personal data. A
// matcher route adds nothing; the catch-all, or no route, is `unmatched`.
export function routeTemplate(root: RouteNode | null): string {
  const paths: string[] = [];
  let node = root?.firstChild ?? null;
  if (!node) return 'unmatched';
  for (; node; node = node.firstChild) {
    const path = node.routeConfig?.path;
    if (path === '**') return 'unmatched';
    if (path) paths.push(path);
  }
  return `/${paths.join('/')}`;
}
