import {
  RefreshDto,
  SessionDto,
  SignInDto,
  SignUpDto,
} from '@motor-fix/contracts';
import {
  Body,
  type CanActivate,
  Controller,
  type ExecutionContext,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { CookieOptions, Request, Response } from 'express';

import { Public } from './actor.guard';
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

const refused = (error: unknown) =>
  error instanceof HttpException &&
  [HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN].includes(error.getStatus());

const PROTOTYPE_KEYS = ['__proto__', 'constructor', 'prototype'];

// A cross-site form can post urlencoded or plain text, never JSON, so another
// site cannot sign this browser into an account it chose. A guard, so it
// answers before the body is validated, whatever the body holds; and a key
// that names the prototype chain is no field of any body.
class JsonOnly implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    if (!req.is('application/json')) {
      throw new HttpException(
        { code: 'unsupported_media_type', message: 'Send JSON' },
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
    }
    const body: unknown = req.body;
    if (
      typeof body === 'object' &&
      body !== null &&
      PROTOTYPE_KEYS.some((key) => Object.hasOwn(body, key))
    ) {
      throw new HttpException(
        { code: 'validation_failed', message: 'Unexpected field' },
        HttpStatus.BAD_REQUEST,
      );
    }
    return true;
  }
}

@ApiTags('auth')
@Controller('auth')
@Public()
export class AuthController {
  constructor(
    private readonly signIns: SignInService,
    private readonly signUps: SignUpService,
  ) {}

  @Post('sign-in')
  @UseGuards(JsonOnly)
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

  @Post('sign-up')
  @UseGuards(JsonOnly)
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: SessionDto })
  async signUp(
    @Body() body: SignUpDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionDto> {
    const issued = await this.signUps.signUp(body, req.ip ?? '');
    keep(res, issued);
    return { accessToken: issued.accessToken };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiBody({ required: false, type: RefreshDto })
  @ApiOkResponse({ type: SessionDto })
  async refresh(
    @Body() body: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionDto> {
    try {
      const issued = await this.signIns.refresh(
        presented(req),
        body.role ?? null,
      );
      keep(res, issued);
      return { accessToken: issued.accessToken };
    } catch (error) {
      // Only a refused token ends the session; an outage keeps the cookie.
      if (refused(error)) forget(res);
      throw error;
    }
  }

  @Post('sign-out-everywhere')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiUnauthorizedResponse()
  async signOutEverywhere(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    try {
      await this.signIns.signOutEverywhere(presented(req));
    } catch (error) {
      // An outage keeps the cookie, so the browser can ask again.
      if (refused(error)) forget(res);
      throw error;
    }
    forget(res);
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
