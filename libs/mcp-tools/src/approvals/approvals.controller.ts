import {
  AccountLoader,
  type Actor,
  ApproveAssistantActionDto,
  AssistantActionApprovalDto,
  AssistantActionApprovalListDto,
  AssistantApprovals,
  CurrentActor,
  type createPrisma,
  MAINTENANCE,
  type MaintenanceReader,
  maintenanceRefusal,
  OpenInMaintenance,
  outbox,
  PRISMA,
  requestContext,
} from '@motor-fix/domain';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { type ApproveDeps, type Approving, approveApproval } from './approvals';
import { catalogue } from '../catalogue';
import { toolContext } from '../context';
import { databaseDown } from '../errors';

const ROUTE = '/api/v1/me/assistant/approvals/:id/approve';

const notFound = () =>
  new HttpException(
    { code: 'not_found', message: 'No such approval' },
    HttpStatus.NOT_FOUND,
  );

// The approval's state, or the refusal its decision is answered with.
function answer(result: Approving): AssistantActionApprovalDto {
  if (result === 'not_found') throw notFound();
  if (result === 'maintenance') throw maintenanceRefusal(ROUTE, 'signed_in');
  if ('invalidOption' in result)
    throw new HttpException(
      {
        code: 'invalid_option',
        field: result.invalidOption,
        message: 'Only the options shown may change, as true or false',
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  if ('notPending' in result)
    throw new HttpException(
      {
        code: 'approval_not_pending',
        currentStatus: result.notPending,
        message: 'This approval is no longer pending',
      },
      HttpStatus.CONFLICT,
    );
  return result;
}

// A database out of reach leaves the approval as it was.
async function reached<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (!databaseDown(error)) throw error;
    throw new HttpException(
      {
        code: 'service_unavailable',
        message: 'MotorFix is not available right now',
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

// The actions the person's assistants wait for them to approve in the app.
// The account is the session's, never the request's.
@ApiTags('me')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'sign_in_required' })
@Controller('me/assistant/approvals')
export class AssistantApprovalsController {
  private readonly deps: ApproveDeps;

  constructor(
    private readonly approvals: AssistantApprovals,
    @Inject(PRISMA) prisma: ReturnType<typeof createPrisma>,
    accounts: AccountLoader,
    @Inject(MAINTENANCE) maintenance: MaintenanceReader,
  ) {
    this.deps = {
      approvals,
      ctx: toolContext({ accounts, maintenance, outbox, prisma }),
      prisma,
      tools: catalogue,
    };
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'The pending approvals, oldest first',
  })
  @ApiOkResponse({ type: AssistantActionApprovalListDto })
  list(@CurrentActor() actor: Actor): Promise<AssistantActionApprovalListDto> {
    return this.approvals.list(actor.accountId);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: "One of the caller's approvals, in any status" })
  @ApiOkResponse({ type: AssistantActionApprovalDto })
  @ApiNotFoundResponse({ description: 'not_found' })
  async get(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
  ): Promise<AssistantActionApprovalDto> {
    const approval = await this.approvals.get(actor.accountId, id);
    if (!approval) throw notFound();
    return approval;
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Run the assistant's action once; failed when a check refuses",
  })
  @ApiOkResponse({ type: AssistantActionApprovalDto })
  @ApiNotFoundResponse({ description: 'not_found' })
  @ApiConflictResponse({ description: 'approval_not_pending, currentStatus' })
  @ApiUnprocessableEntityResponse({ description: 'invalid_option, field' })
  @ApiServiceUnavailableResponse({
    description: 'maintenance or service_unavailable; still pending',
  })
  approve(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: ApproveAssistantActionDto,
  ): Promise<AssistantActionApprovalDto> {
    return reached(async () =>
      answer(
        await approveApproval(this.deps, {
          accountId: actor.accountId,
          by: this.decider(actor),
          id,
          options: body.options,
        }),
      ),
    );
  }

  // Writes the decision only, so maintenance does not hold it.
  @OpenInMaintenance()
  @Post(':id/refuse')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Refuse the assistant's action; nothing runs" })
  @ApiOkResponse({ type: AssistantActionApprovalDto })
  @ApiNotFoundResponse({ description: 'not_found' })
  @ApiConflictResponse({ description: 'approval_not_pending, currentStatus' })
  refuse(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
  ): Promise<AssistantActionApprovalDto> {
    const { requestId, ...by } = this.decider(actor);
    return reached(async () =>
      answer(await this.approvals.refuse(actor.accountId, id, by, requestId)),
    );
  }

  private decider(actor: Actor) {
    return {
      id: actor.accountId,
      requestId: requestContext.getStore()?.requestId,
      role: actor.role,
    };
  }
}
