import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  // The session lives in the browser's memory, so dashboards render there.
  { path: 'app/**', renderMode: RenderMode.Client },
  { path: '**', renderMode: RenderMode.Server },
];
