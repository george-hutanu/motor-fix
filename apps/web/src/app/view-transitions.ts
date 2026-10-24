import { inject } from '@angular/core';
import {
  type ActivatedRouteSnapshot,
  Router,
  type ViewTransitionInfo,
} from '@angular/router';
import { REDUCED_MOTION } from '@motor-fix/ui-cockpit';

// The path a route tree stands for, without its query or fragment.
function pathOf(route: ActivatedRouteSnapshot | null): string {
  const parts: string[] = [];
  for (let at = route; at; at = at.firstChild)
    parts.push(...at.url.map((segment) => segment.path));
  return parts.join('/');
}

// Screens cross-fade into each other, the browser's default. A navigation
// that keeps the screen (only the query or the fragment changes) or rewrites
// its address in place (the language) moves nothing, and nothing moves for a
// person who asked their device for reduced motion.
export function skipStillTransitions({
  transition,
  from,
  to,
}: ViewTransitionInfo) {
  const inPlace =
    inject(Router).currentNavigation()?.extras.replaceUrl === true;
  if (inject(REDUCED_MOTION)() || inPlace || pathOf(from) === pathOf(to))
    transition.skipTransition();
}
