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
