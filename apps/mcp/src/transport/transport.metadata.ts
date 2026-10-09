import { Controller, Get, Header, Inject } from '@nestjs/common';

import { ISSUER_SETTINGS, type IssuerSettings } from '../auth/auth.verifier';

// RFC 9728 names the path-specific URL; some clients still ask the bare one.
@Controller('.well-known/oauth-protected-resource')
export class TransportMetadataController {
  constructor(
    @Inject(ISSUER_SETTINGS) private readonly settings: IssuerSettings,
  ) {}

  @Get(['', 'mcp'])
  @Header('Access-Control-Allow-Origin', '*')
  @Header('Cache-Control', 'public, max-age=3600')
  metadata() {
    return {
      authorization_servers: [this.settings.issuer],
      bearer_methods_supported: ['header'],
      resource: this.settings.mcpUrl,
      scopes_supported: ['motorfix.read', 'motorfix.act'],
    };
  }
}
