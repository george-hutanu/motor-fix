import {
  PasswordResetCheckDto,
  PasswordResetCompleteDto,
  PasswordResetDto,
  SessionDto,
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
  ApiGoneResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { PasswordResetService } from './password-reset.service';
import { Public } from '../../actor.guard';
import { JsonOnly, keep } from '../../auth.controller';

@ApiTags('auth')
@Controller('auth/password-reset')
@Public()
@UseGuards(JsonOnly)
export class PasswordResetController {
  constructor(private readonly resets: PasswordResetService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({
    description: 'The same answer whether or not an account uses the address',
  })
  async ask(@Body() body: PasswordResetDto, @Req() req: Request) {
    await this.resets.ask(body.email, req.ip ?? '');
  }

  @Post('check')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'The link still works' })
  @ApiGoneResponse({ description: 'token_expired or token_invalid' })
  async check(@Body() body: PasswordResetCheckDto) {
    await this.resets.check(body.token);
  }

  @Post('complete')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SessionDto })
  @ApiGoneResponse({ description: 'token_expired or token_invalid' })
  async complete(
    @Body() body: PasswordResetCompleteDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionDto> {
    const issued = await this.resets.complete(body.token, body.password);
    keep(res, issued);
    return { accessToken: issued.accessToken };
  }
}
