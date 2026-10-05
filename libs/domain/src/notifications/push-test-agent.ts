import { Agent } from 'node:https';
import { connect } from 'node:net';

// web-push only speaks https. This agent opens a plain socket instead, so a
// spec can run the push service as an ordinary local HTTP server.
export function plainAgent(): Agent {
  const agent = new Agent();
  (agent as unknown as { createConnection: unknown }).createConnection =
    (options: { host?: string; port?: number }) =>
      connect({ host: options.host, port: Number(options.port) });
  return agent;
}
