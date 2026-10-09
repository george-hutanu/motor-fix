import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  AccountLoader,
  type createPrisma,
  MAINTENANCE,
  type MaintenanceReader,
  PRISMA,
} from '@motor-fix/domain';
import {
  type Caller,
  databaseDown,
  register,
  type ToolContext,
  type ToolDefinition,
} from '@motor-fix/mcp-tools';
import {
  Controller,
  Delete,
  Get,
  HttpException,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

import { McpActorService } from '../auth/auth.actor';
import {
  type AuthedRequest,
  metadataUrlOf,
  type Refusal,
  refuse,
} from '../auth/auth.middleware';
import { ISSUER_SETTINGS, type IssuerSettings } from '../auth/auth.verifier';
import {
  type AuthFailure,
  observeToolCall,
  recordAuthFailure,
  toolLabel,
} from '../metrics/metrics';

export const MCP_TOOLS = Symbol('MCP_TOOLS');

type Prisma = ReturnType<typeof createPrisma>;

const FAILURES: Record<string, AuthFailure> = {
  account_suspended: 'suspended',
  assistant_grant_revoked: 'revoked',
  sign_in_required: 'no_account',
};

@Controller('mcp')
export class TransportController {
  private readonly ctx: ToolContext;
  private readonly metadataUrl: string;
  private readonly toolNames: string[];

  constructor(
    private readonly actors: McpActorService,
    @Inject(MCP_TOOLS) private readonly tools: ToolDefinition[],
    @Inject(ISSUER_SETTINGS) settings: IssuerSettings,
    @Inject(PRISMA) prisma: Prisma,
    accounts: AccountLoader,
    @Inject(MAINTENANCE) maintenance: MaintenanceReader,
  ) {
    this.metadataUrl = metadataUrlOf(settings.mcpUrl);
    this.toolNames = tools.map((t) => t.name);
    this.ctx = {
      accounts,
      featureOn: async (garageId, key) =>
        (
          await prisma.garageFeature.findUnique({
            where: { garageId_key: { garageId, key } },
          })
        )?.enabled ?? true,
      maintenance,
    };
  }

  @Post()
  async handle(@Req() req: AuthedRequest, @Res() res: Response) {
    const caller = await this.callerOf(req, res);
    if (!caller) return;
    const server = new Server(
      { name: 'motorfix', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );
    register(server, this.tools, caller, this.ctx, (name, call) =>
      observeToolCall(
        {
          accountId: caller.account.id,
          clientId: (req.auth as AuthInfo).clientId,
          requestId: caller.requestId,
          tool: toolLabel(name, this.toolNames),
        },
        call,
      ),
    );
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
      sessionIdGenerator: undefined,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }

  @Get()
  get(@Res() res: Response) {
    this.notAllowed(res);
  }

  @Delete()
  delete(@Res() res: Response) {
    this.notAllowed(res);
  }

  private async callerOf(
    req: AuthedRequest,
    res: Response,
  ): Promise<Caller | null> {
    const requestId = String(res.getHeader('X-Request-Id'));
    try {
      // The bearer check runs first, so the token is verified here.
      return await this.actors.caller(req.auth as AuthInfo, requestId);
    } catch (error) {
      if (databaseDown(error)) {
        refuse(res, 503, {
          code: 'service_unavailable',
          message: 'MotorFix is not available right now. Try again later.',
        });
        return null;
      }
      if (!(error instanceof HttpException)) throw error;
      const status = error.getStatus();
      const body = error.getResponse() as Refusal;
      const reason = FAILURES[body.code];
      if (reason) recordAuthFailure(reason);
      refuse(
        res,
        status,
        body,
        status === 401
          ? { invalidToken: true, metadataUrl: this.metadataUrl }
          : undefined,
      );
      return null;
    }
  }

  private notAllowed(res: Response) {
    res.setHeader('Allow', 'POST');
    refuse(res, 405, {
      code: 'method_not_allowed',
      message: 'This server is stateless: send every call as a POST.',
    });
  }
}
