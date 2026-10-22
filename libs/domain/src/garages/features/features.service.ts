import {
  FEATURE_KEYS,
  type FeatureKey,
  type GarageFeaturesDto,
} from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { featureOn } from './feature-on';
import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import type { Actor } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { refusal } from '../../auth/sign-up.service';
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import {
  assertGarageOwner,
  notFound,
} from '../garage-brands/garage-brands.service';

const isFeatureKey = (key: string): key is FeatureKey =>
  (FEATURE_KEYS as readonly string[]).includes(key);

// The row locked, so two changes to one garage run one after the other.
async function lockGarage(tx: Prisma.TransactionClient, garageId: string) {
  const [row] = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM garage WHERE id = ${garageId}::uuid FOR UPDATE`;
  if (!row) throw notFound();
}

async function switches(
  tx: Prisma.TransactionClient,
  garageId: string,
): Promise<GarageFeaturesDto['features']> {
  const features = {} as GarageFeaturesDto['features'];
  // One query per key, in turn: the transaction runs one at a time anyway.
  for (const key of FEATURE_KEYS) {
    features[key] = await featureOn(tx, garageId, key);
  }
  return features;
}

@Injectable()
export class GarageFeaturesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
  ) {}

  async set(
    actor: Actor,
    garageId: string,
    key: string,
    enabled: boolean,
  ): Promise<GarageFeaturesDto> {
    assertGarageOwner(actor, garageId);
    if (!isFeatureKey(key)) {
      throw refusal(
        HttpStatus.BAD_REQUEST,
        'validation_failed',
        'No such feature',
        [{ code: 'unknown_feature', field: 'feature' }],
      );
    }
    return this.prisma.$transaction(async (tx) => {
      await lockGarage(tx, garageId);
      const features = await switches(tx, garageId);
      const before = features[key];
      if (before === enabled) return { features };
      if (key === 'team_mechanics' && !enabled) {
        await this.assertNoOtherMechanic(tx, actor, garageId);
      }
      await tx.garageFeature.upsert({
        create: { enabled, garageId, key },
        update: { enabled },
        where: { garageId_key: { garageId, key } },
      });
      await this.audit.record(tx, {
        action: 'update',
        actorId: actor.accountId,
        actorRole: actor.role,
        field: key,
        garageId,
        newValue: enabled,
        oldValue: before,
        subjectId: garageId,
        subjectType: 'garage_feature',
      });
      await this.events.record(tx, {
        audience: { garageIds: [garageId], type: 'garage' },
        kind: 'garage.features_changed',
        payload: { enabled, feature: key, garageId },
        subjectId: garageId,
      });
      return { features: { ...features, [key]: enabled } };
    });
  }

  // The owner's own mechanic row is the owner: it never blocks the switch.
  private async assertNoOtherMechanic(
    tx: Prisma.TransactionClient,
    actor: Actor,
    garageId: string,
  ) {
    const others = await tx.mechanic.count({
      where: {
        garageId,
        OR: [{ accountId: null }, { accountId: { not: actor.accountId } }],
      },
    });
    if (others > 0) {
      throw refusal(
        HttpStatus.CONFLICT,
        'mechanics_on_team',
        'Remove the mechanics from the team first.',
      );
    }
  }
}
