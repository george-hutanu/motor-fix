import { SessionDto, SignInDto, SignUpDto } from '@motor-fix/contracts';
import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { CookieOptions, Request, Response } from 'express';

import { type Issued, REMEMBERED_MS, SignInService } from './sign-in.service';
import { SignUpService } from './sign-up.service';

const COOKIE = 'mf_refresh';

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

// A cross-site form can post urlencoded or plain text, never JSON, so another
// site cannot sign this browser into an account it chose.
function requireJson(req: Request) {
  if (!req.is('application/json')) {
    throw new HttpException(
      { code: 'unsupported_media_type', message: 'Send JSON' },
      HttpStatus.UNSUPPORTED_MEDIA_TYPE,
    );
  }
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly signIns: SignInService,
    private readonly signUps: SignUpService,
  ) {}

  @Post('sign-in')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SessionDto })
  async signIn(
    @Body() body: SignInDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionDto> {
    requireJson(req);
    const issued = await this.signIns.signIn(body, req.ip ?? '');
    keep(res, issued);
    return { accessToken: issued.accessToken };
  }

  @Post('sign-up')
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: SessionDto })
  async signUp(
    @Body() body: SignUpDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionDto> {
    requireJson(req);
    const issued = await this.signUps.signUp(body, req.ip ?? '');
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
      // Only a refused token ends the session; an outage keeps the cookie.
      if (
        error instanceof HttpException &&
        [HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN].includes(
          error.getStatus(),
        )
      ) {
        forget(res);
      }
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
