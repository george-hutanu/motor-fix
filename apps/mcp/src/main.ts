import './telemetry';

import { readEnv } from '@motor-fix/contracts';

import { createMcpApp, MCP_ENV } from './mcp.module';

async function main() {
  const env = readEnv(MCP_ENV);
  const app = await createMcpApp({
    databaseUrl: env.DATABASE_URL,
    issuer: env.ASSISTANT_ISSUER,
    mcpUrl: env.MCP_URL,
  });
  app.enableShutdownHooks();
  await app.listen(Number(process.env['PORT'] ?? 3002));
}

void main();
