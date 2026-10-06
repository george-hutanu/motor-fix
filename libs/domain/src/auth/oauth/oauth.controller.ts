import {
  OAuthCompleteDto,
  OAuthPendingDto,
  type OAuthProvider,
  ProvidersDto,
  SessionDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiFoundResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import type { CookieOptions, Request, Response } from 'express';

import { FLOW_TTL_S, OAuthService, type Outcome } from './oauth.service';
import { Public } from '../actor.guard';
import { cookieOf, JsonOnly, keep } from '../auth.controller';

const FLOW = 'mf_oauth';
const PENDING = 'mf_oauth_pending';

const SCOPE: CookieOptions = {
  httpOnly: true,
  path: '/api/v1/auth/oauth',
  secure: true,
};
// Apple posts its answer from its own site, so the flow cookie must travel
// on a cross-site post; the state it carries is what makes that safe.
const FLOW_FLAGS: CookieOptions = { ...SCOPE, sameSite: 'none' };
const PENDING_FLAGS: CookieOptions = { ...SCOPE, sameSite: 'lax' };

@ApiTags('auth')
@Controller('auth')
@Public()
export class OauthController {
  constructor(private readonly oauth: OAuthService) {}

  @Get('providers')
  @ApiOkResponse({ type: ProvidersDto })
  providers(): ProvidersDto {
    return this.oauth.configured();
  }

  @Get('oauth/pending')
  @ApiOkResponse({ type: OAuthPendingDto })
  @ApiNotFoundResponse({ description: 'No pending sign-up in this browser' })
  pending(@Req() req: Request): Promise<OAuthPendingDto> {
    return this.oauth.pending(cookieOf(req, PENDING));
  }

  @Post('oauth/complete')
  @UseGuards(JsonOnly)
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: SessionDto })
  @ApiBadRequestResponse({
    description: 'consent_required, or provider_failed: no pending sign-up',
  })
  @ApiConflictResponse({ description: 'email_taken' })
  @ApiServiceUnavailableResponse({ description: 'maintenance' })
  @ApiUnsupportedMediaTypeResponse({ description: 'The body is not JSON' })
  async complete(
    @Body() body: OAuthCompleteDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionDto> {
    const issued = await this.oauth.complete(cookieOf(req, PENDING), body);
    res.clearCookie(PENDING, PENDING_FLAGS);
    keep(res, issued);
    return { accessToken: issued.accessToken };
  }

  // Opened as pages, not called: they leave for the provider.
  @Get('oauth/google')
  @ApiQuery({ enum: ['ro', 'en'], name: 'language', required: false })
  @ApiQuery({ name: 'remember', required: false, type: Boolean })
  @ApiFoundResponse({ description: "To Google's authorisation" })
  @ApiNotFoundResponse({ description: 'Google is not configured' })
  startGoogle(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.start('google', req, res);
  }

  @Get('oauth/apple')
  @ApiQuery({ enum: ['ro', 'en'], name: 'language', required: false })
  @ApiQuery({ name: 'remember', required: false, type: Boolean })
  @ApiFoundResponse({ description: "To Apple's authorisation" })
  @ApiNotFoundResponse({ description: 'Apple is not configured' })
  startApple(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.start('apple', req, res);
  }

  @Get('oauth/google/callback')
  @ApiFoundResponse({
    description: "To the web's return page, with the result",
  })
  google(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.back('google', req.query, req, res);
  }

  // Apple posts its answer as a form.
  @Post('oauth/apple/callback')
  @ApiFoundResponse({
    description: "To the web's return page, with the result",
  })
  apple(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.back('apple', req.body ?? {}, req, res);
  }

  private async start(provider: OAuthProvider, req: Request, res: Response) {
    const language = req.query['language'] === 'en' ? 'en' : 'ro';
    const started = await this.oauth.start(provider, {
      language,
      remember: req.query['remember'] !== 'false',
    });
    if (!started) {
      const query = new URLSearchParams({ provider, result: 'failed' });
      res.redirect(HttpStatus.FOUND, `/${language}/sign-in/return?${query}`);
      return;
    }
    res.cookie(FLOW, started.state, {
      ...FLOW_FLAGS,
      maxAge: FLOW_TTL_S * 1000,
    });
    res.redirect(HttpStatus.FOUND, started.url);
  }

  private async back(
    provider: OAuthProvider,
    fields: Record<string, unknown>,
    req: Request,
    res: Response,
  ) {
    const outcome: Outcome = await this.oauth.finish(
      provider,
      cookieOf(req, FLOW),
      fields,
    );
    res.clearCookie(FLOW, FLOW_FLAGS);
    if (outcome.issued) keep(res, outcome.issued);
    if (outcome.pending) {
      res.cookie(PENDING, outcome.pending, {
        ...PENDING_FLAGS,
        maxAge: FLOW_TTL_S * 1000,
      });
    }
    const query = new URLSearchParams({ provider, result: outcome.result });
    res.redirect(
      HttpStatus.FOUND,
      `/${outcome.language}/sign-in/return?${query}`,
    );
  }
}
