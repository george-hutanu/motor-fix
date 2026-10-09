import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createMcpApp } from './mcp.module';

// Nothing here reaches the database, which only an authenticated call
// contacts. The identity server probe does run, against a closed port: it logs
// the server down once and changes nothing a spec reads.
export async function bootMcp() {
  const app = await createMcpApp({
    databaseUrl: 'postgresql://127.0.0.1:1/unused',
    issuer: 'http://127.0.0.1:1/realms/motorfix-assistants',
    mcpUrl: 'http://127.0.0.1:3002/mcp',
  });
  await app.listen(0, '127.0.0.1');
  const { port } = (app.getHttpServer() as Server).address() as AddressInfo;
  return { app, base: `http://127.0.0.1:${port}`, port };
}
