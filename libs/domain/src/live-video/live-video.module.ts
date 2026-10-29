import {
  type AppEnv,
  type LiveVideoSecrets,
  liveVideoSecrets,
} from '@motor-fix/contracts';
import { type DynamicModule, Logger, Module } from '@nestjs/common';

import {
  CloudflareLiveVideo,
  signingKey,
} from './providers/cloudflare-live-video.provider';
import { FakeLiveVideo } from './providers/fake-live-video.provider';
import {
  LIVE_VIDEO_PROVIDER,
  type LiveVideoProvider,
  NONE,
} from './providers/live-video.provider';
import { LiveSessionsController } from './sessions/sessions.controller';
import { LiveSessionsService } from './sessions/sessions.service';
import { AUDIT_PORT } from '../audit/audit.port';
import { AuditService } from '../audit/audit.service';

export type LiveVideoConfig =
  | { provider: 'cloudflare'; secrets: LiveVideoSecrets }
  | { provider: 'fake' }
  | { provider: 'none' };

// Chosen once at boot: a full, readable set of secrets wins; tests without
// one get the stand-in; anywhere else live video says it is unavailable.
export function liveVideoConfig(
  appEnv: AppEnv,
  source: Record<string, string | undefined>,
): LiveVideoConfig {
  const secrets = liveVideoSecrets(source);
  if (secrets) {
    try {
      signingKey(secrets.CLOUDFLARE_STREAM_SIGNING_KEY_PEM);
      return { provider: 'cloudflare', secrets };
    } catch {
      new Logger('LiveVideo').warn(
        'CLOUDFLARE_STREAM_SIGNING_KEY_PEM is not a readable private key',
      );
    }
  }
  return appEnv === 'test' ? { provider: 'fake' } : { provider: 'none' };
}

export function providerFor(config: LiveVideoConfig): LiveVideoProvider {
  const logger = new Logger('LiveVideo');
  if (config.provider === 'none') {
    logger.warn('live video off: the CLOUDFLARE_STREAM_* values are not set');
    return NONE;
  }
  const provider =
    config.provider === 'cloudflare'
      ? new CloudflareLiveVideo(config.secrets)
      : new FakeLiveVideo();
  logger.log(`live video: ${provider.name}`);
  return provider;
}

// Starting a live stream on a job and handing out its viewing link. Needs the
// global AuthModule for Prisma and the event port.
@Module({})
export class LiveVideoModule {
  static register(config: LiveVideoConfig): DynamicModule {
    return {
      controllers: [LiveSessionsController],
      module: LiveVideoModule,
      providers: [
        { provide: LIVE_VIDEO_PROVIDER, useValue: providerFor(config) },
        { provide: AUDIT_PORT, useClass: AuditService },
        LiveSessionsService,
      ],
    };
  }
}
