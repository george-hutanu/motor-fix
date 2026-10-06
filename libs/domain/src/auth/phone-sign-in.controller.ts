import {
  PhoneCodeDto,
  PhoneSessionDto,
  PhoneSignInDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiGoneResponse,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { Public } from './actor.guard';
import { JsonOnly, keep } from './auth.controller';
import { PhoneSignInService } from './phone-sign-in.service';

@ApiTags('auth')
@Controller('auth')
@Public()
@UseGuards(JsonOnly)
export class PhoneSignInController {
  constructor(private readonly phones: PhoneSignInService) {}

  @Post('phone-code')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({
    description: 'The same answer whether or not an account holds the number',
  })
  @ApiTooManyRequestsResponse({ description: 'too_many_attempts' })
  @ApiBadGatewayResponse({ description: 'whatsapp_failed' })
  async phoneCode(@Body() body: PhoneCodeDto, @Req() req: Request) {
    await this.phones.issue(body.phone, body.language ?? 'ro', req.ip ?? '');
  }

  @Post('phone-sign-in')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PhoneSessionDto })
  @ApiBadRequestResponse({ description: 'validation_failed, consent_required' })
  @ApiUnauthorizedResponse({ description: 'code_invalid' })
  @ApiConflictResponse({ description: 'phone_taken' })
  @ApiGoneResponse({ description: 'code_expired' })
  @ApiTooManyRequestsResponse({ description: 'too_many_attempts' })
  async phoneSignIn(
    @Body() body: PhoneSignInDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PhoneSessionDto> {
    const issued = await this.phones.signIn(body);
    if (issued === 'profile') return { next: 'profile' };
    keep(res, issued);
    return { accessToken: issued.accessToken };
  }
}
