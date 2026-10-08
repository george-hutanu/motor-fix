import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import {
  ISSUER_SETTINGS,
  type IssuerSettings,
  TokenVerifier,
} from './auth.verifier';

export interface Refusal {
  code: string;
  message: string;
}

export type AuthedRequest = Request & { auth?: AuthInfo };

// `challenge` names the metadata a client signs in through; `invalidToken`
// tells it the token it sent is no longer good.
export function refuse(
  res: Response,
  status: number,
  body: Refusal,
  challenge?: { metadataUrl: string; invalidToken: boolean },
) {
  if (challenge)
    res.setHeader(
      'WWW-Authenticate',
      `Bearer ${challenge.invalidToken ? 'error="invalid_token", ' : ''}resource_metadata="${challenge.metadataUrl}"`,
    );
  res.status(status).json(body);
}

export const metadataUrlOf = (mcpUrl: string) =>
  getOAuthProtectedResourceMetadataUrl(new URL(mcpUrl));

@Injectable()
export class BearerAuth implements NestMiddleware {
  private readonly metadataUrl: string;

  constructor(
    @Inject(TokenVerifier) private readonly verifier: OAuthTokenVerifier,
    @Inject(ISSUER_SETTINGS) settings: IssuerSettings,
  ) {
    this.metadataUrl = metadataUrlOf(settings.mcpUrl);
  }

  async use(req: AuthedRequest, res: Response, next: NextFunction) {
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token)
      return refuse(
        res,
        401,
        { code: 'sign_in_required', message: 'Sign in to MotorFix first.' },
        { invalidToken: false, metadataUrl: this.metadataUrl },
      );
    try {
      req.auth = await this.verifier.verifyAccessToken(token);
    } catch (error) {
      if (error instanceof InvalidTokenError)
        return refuse(
          res,
          401,
          { code: 'invalid_token', message: 'Sign in to MotorFix again.' },
          { invalidToken: true, metadataUrl: this.metadataUrl },
        );
      return refuse(res, 503, {
        code: 'service_unavailable',
        message: 'MotorFix cannot check sign-ins right now. Try again soon.',
      });
    }
    next();
  }
}
