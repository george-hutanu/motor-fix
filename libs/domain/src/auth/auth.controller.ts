import { SessionDto, SignInDto } from '@motor-fix/contracts';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { CookieOptions, Request, Response } from 'express';

import { type Issued, SignInService } from './sign-in.service';

const COOKIE = 'mf_refresh';
const REMEMBERED_MS = 30 * 86_400_000;

// Sent only to these calls, never readable by the page, never cross-site.
const FLAGS: CookieOptions = {
  httpOnly: true,
  path: '/api/v1/auth',
  sameSite: 'strict',
  secure: true,
};

function presented(req: Request): string | undefined {
  for (const pair of (req.header('cookie') ?? '').split(';')) {
    const [name, ...value] = pair.trim().split('=');
    if (name === COOKIE) return value.join('=');
  }
  return undefined;
}

function keep(res: Response, issued: Issued) {
  if (!issued.refreshToken) return;
  res.cookie(COOKIE, issued.refreshToken, {
    ...FLAGS,
    ...(issued.remember && { maxAge: REMEMBERED_MS }),
  });
}

const forget = (res: Response) => res.clearCookie(COOKIE, FLAGS);

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly signIns: SignInService) {}

  @Post('sign-in')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SessionDto })
  async signIn(
    @Body() body: SignInDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionDto> {
    const issued = await this.signIns.signIn(body, req.ip ?? '');
    keep(res, issued);
    return { accessToken: issued.accessToken };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SessionDto })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionDto> {
    try {
      const issued = await this.signIns.refresh(presented(req));
      keep(res, issued);
      return { accessToken: issued.accessToken };
    } catch (error) {
      forget(res);
      throw error;
    }
  }

  @Post('sign-out')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async signOut(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.signIns.signOut(presented(req));
    forget(res);
  }
}
