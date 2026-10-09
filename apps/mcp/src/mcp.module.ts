import { randomUUID } from 'node:crypto';

import {
  AccountLoader,
  AUDIT_PORT,
  AuditService,
  createPrisma,
  EVENT_PORT,
  JsonLogger,
  MAINTENANCE,
  maintenanceOff,
  outbox,
  PRISMA,
  requestContext,
} from '@motor-fix/domain';
import { catalogue, type ToolDefinition } from '@motor-fix/mcp-tools';
import {
  Controller,
  type DynamicModule,
  Get,
  Inject,
  type MiddlewareConsumer,
  Module,
  type NestModule,
  type OnModuleDestroy,
  RequestMethod,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';

import { McpActorService } from './auth/auth.actor';
import { AssistantGrants } from './auth/auth.grants';
import { BearerAuth } from './auth/auth.middleware';
import { IssuerProbe } from './auth/auth.probe';
import { ISSUER_SETTINGS, TokenVerifier } from './auth/auth.verifier';
import { recordRequest } from './metrics/metrics';
import {
  MCP_TOOLS,
  TransportController,
} from './transport/transport.controller';
import { TransportMetadataController } from './transport/transport.metadata';

export const MCP_ENV = ['DATABASE_URL', 'MCP_URL', 'ASSISTANT_ISSUER'] as const;

interface McpSettings {
  databaseUrl: string;
  issuer: string;
  mcpUrl: string;
}

// A client's id is kept only when it is short and plain, so it cannot flood or
// forge log lines.
const REQUEST_ID = /^[\w.-]{1,128}$/;

@Controller('health')
class LiveController {
  @Get('live')
  live() {
    return { status: 'ok' };
  }
}

@Module({})
class McpModule implements NestModule, OnModuleDestroy {
  constructor(
    @Inject(PRISMA) private readonly prisma: ReturnType<typeof createPrisma>,
  ) {}

  static register(
    settings: McpSettings,
    tools: ToolDefinition[] = catalogue,
  ): DynamicModule {
    return {
      controllers: [
        LiveController,
        TransportController,
        TransportMetadataController,
      ],
      module: McpModule,
      providers: [
        { provide: PRISMA, useValue: createPrisma(settings.databaseUrl) },
        {
          provide: ISSUER_SETTINGS,
          useValue: { issuer: settings.issuer, mcpUrl: settings.mcpUrl },
        },
        { provide: AUDIT_PORT, useClass: AuditService },
        { provide: EVENT_PORT, useValue: outbox },
        { provide: MAINTENANCE, useValue: maintenanceOff },
        { provide: MCP_TOOLS, useValue: tools },
        AccountLoader,
        AssistantGrants,
        BearerAuth,
        IssuerProbe,
        McpActorService,
        TokenVerifier,
      ],
    };
  }

  configure(consumer: MiddlewareConsumer) {
    // The body is read only once the token is checked, so a caller with no
    // token learns nothing from how its body parses.
    consumer
      .apply(BearerAuth, express.json())
      .forRoutes({ method: RequestMethod.POST, path: 'mcp' });
  }

  onModuleDestroy() {
    return this.prisma.$disconnect();
  }
}

export async function createMcpApp(
  settings: McpSettings,
  tools: ToolDefinition[] = catalogue,
) {
  const instance = express();
  instance.set('case sensitive routing', true);
  instance.set('strict routing', true);
  instance.set('trust proxy', 'loopback, linklocal, uniquelocal');
  instance.use((req: Request, res: Response, next: NextFunction) => {
    const given = req.header('x-request-id');
    const requestId = given && REQUEST_ID.test(given) ? given : randomUUID();
    res.setHeader('X-Request-Id', requestId);
    if (req.path === '/mcp')
      res.on('finish', () => recordRequest(res.statusCode));
    requestContext.run({ requestId }, next);
  });
  return NestFactory.create(
    McpModule.register(settings, tools),
    new ExpressAdapter(instance),
    { bodyParser: false, logger: new JsonLogger() },
  );
}
