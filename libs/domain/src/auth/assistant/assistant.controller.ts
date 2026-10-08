import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiFoundResponse,
  ApiGoneResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';

import {
  ApproveAssistantSignInDto,
  AssistantApprovalDto,
  AssistantTokenDto,
  AssistantTokensDto,
} from './assistant.dto';
import { ASSISTANT_THROTTLE, AssistantService } from './assistant.service';
import type { AddressThrottle } from '../../rate-limit/address-throttle';
import { CurrentActor, Public } from '../actor.guard';
import type { Actor } from '../policy';

// The identity server's view of MotorFix sign-in: authorize and token are its
// calls, approve is the signed-in person's on the connect page.
@ApiTags('auth')
@Controller('auth/assistant')
export class AssistantController {
  constructor(
    private readonly assistant: AssistantService,
    @Inject(ASSISTANT_THROTTLE) private readonly throttle: AddressThrottle,
  ) {}

  // Opened as a page: it leaves for the web connect route.
  @Public()
  @Get('authorize')
  @ApiQuery({ name: 'client_id' })
  @ApiQuery({ name: 'redirect_uri' })
  @ApiQuery({ enum: ['code'], name: 'response_type' })
  @ApiQuery({ name: 'state' })
  @ApiQuery({ name: 'nonce' })
  @ApiQuery({ name: 'scope', required: false })
  @ApiFoundResponse({ description: 'To the web connect route' })
  @ApiBadRequestResponse({
    description: 'invalid_client, unsupported_response_type, invalid_request',
  })
  @ApiTooManyRequestsResponse({ description: 'too_many_attempts' })
  async authorize(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.admit(req);
    res.redirect(HttpStatus.FOUND, this.assistant.authorize(req.query));
  }

  @Post('approve')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOkResponse({ type: AssistantApprovalDto })
  @ApiBadRequestResponse({ description: 'invalid_request' })
  @ApiGoneResponse({ description: 'request_expired' })
  async approve(
    @CurrentActor() actor: Actor,
    @Body() body: ApproveAssistantSignInDto,
  ): Promise<AssistantApprovalDto> {
    return {
      redirect: await this.assistant.approve(body.request, actor.accountId),
    };
  }

  @Public()
  @Post('token')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('application/x-www-form-urlencoded', 'application/json')
  @ApiOkResponse({ type: AssistantTokensDto })
  @ApiBadRequestResponse({
    description: 'invalid_grant, unsupported_grant_type',
  })
  @ApiUnauthorizedResponse({ description: 'invalid_client' })
  @ApiTooManyRequestsResponse({ description: 'too_many_attempts' })
  async token(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: AssistantTokenDto,
  ): Promise<AssistantTokensDto> {
    res.setHeader('Cache-Control', 'no-store');
    await this.admit(req);
    return this.assistant.exchange({ ...body });
  }

  private async admit(req: Request) {
    const wait = await this.throttle.take(req.ip ?? '');
    if (wait === null) return;
    throw new HttpException(
      {
        code: 'too_many_attempts',
        message: 'Too many attempts; try again shortly',
        retryAfterSeconds: wait,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
