import { inject } from '@angular/core';
import {
  type ActivatedRouteSnapshot,
  type ViewTransitionInfo,
  withViewTransitions,
} from '@angular/router';
import { REDUCED_MOTION } from '@motor-fix/ui-cockpit';

// The path a route tree stands for, without its query or fragment.
function pathOf(route: ActivatedRouteSnapshot | null): string {
  const parts: string[] = [];
  for (let at = route; at; at = at.firstChild)
    parts.push(...at.url.map((segment) => segment.path));
  return parts.join('/');
}

// The screen a route tree shows: its path without the language in front, so
// the language switch, which rewrites the address in place, stays on it.
const screenOf = (route: ActivatedRouteSnapshot | null) =>
  pathOf(route).replace(/^(?:ro|en)(?:\/|$)/, '');

// Screens cross-fade into each other, the browser's default. A navigation
// that keeps the screen (only the query, the fragment or the language
// changes) moves nothing, nor does the first screen as the page loads, and
// nothing moves for a person who asked their device for reduced motion.
function skipStillTransitions({ transition, from, to }: ViewTransitionInfo) {
  if (inject(REDUCED_MOTION)() || screenOf(from) === screenOf(to))
    transition.skipTransition();
}

export const screenTransitions = () =>
  withViewTransitions({
    onViewTransitionCreated: skipStillTransitions,
    skipInitialTransition: true,
  });
