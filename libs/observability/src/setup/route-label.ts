import { context } from '@opentelemetry/api';
import { getRPCMetadata, RPCType } from '@opentelemetry/core';

interface RoutedRequest {
  baseUrl?: string;
  route?: { path?: unknown };
}

interface FinishingResponse {
  once(event: 'finish', listener: () => void): unknown;
}

// Names the request span and its duration metric by the route template
// (`GET /api/v1/garages/:id`), never the path. The HTTP instrumentation reads
// the route when the response closes, after `finish`. A path no route
// matched keeps the method alone.
export function routeLabel() {
  return (req: RoutedRequest, res: FinishingResponse, next: () => void) => {
    const rpc = getRPCMetadata(context.active());
    if (rpc?.type === RPCType.HTTP) {
      res.once('finish', () => {
        const path = req.route?.path;
        if (typeof path === 'string') rpc.route = `${req.baseUrl ?? ''}${path}`;
      });
    }
    next();
  };
}

// Names the active request span by a route template set by the code that
// handled it (an Angular route, the API pass-through), for a server whose
// routes Express does not know.
export function setRoute(template: string): void {
  const rpc = getRPCMetadata(context.active());
  if (rpc?.type === RPCType.HTTP) rpc.route = template;
}
