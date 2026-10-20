import {
  FEATURE_KEYS,
  isSurveySection,
  startingFeatures,
  surveyComplete,
} from '@motor-fix/contracts';
import { HttpStatus } from '@nestjs/common';

import type { AuditPort } from '../../audit/audit.port';
import { refusal } from '../../auth/sign-up.service';
import type { Prisma } from '../../generated/prisma/client';

// Stores a new garage's sign-up survey and switches its five features on or
// off from the answers, inside the caller's transaction (the account's
// creation), so a roll-back there leaves none of it. The new owner is the
// actor of each feature's first entry in the history.
export async function applySurvey(
  tx: Prisma.TransactionClient,
  {
    garageId,
    answers,
    actorId,
  }: { garageId: string; answers: unknown; actorId: string },
  audit: AuditPort,
): Promise<void> {
  if (!isSurveySection(answers) || !surveyComplete(answers)) {
    throw refusal(
      HttpStatus.BAD_REQUEST,
      'validation_failed',
      'The survey needs its five answers, each one of its codes',
    );
  }
  if (await tx.garageSurvey.findUnique({ where: { garageId } })) {
    throw refusal(
      HttpStatus.CONFLICT,
      'survey_already_answered',
      'This garage has answered its survey already',
    );
  }
  await tx.garageSurvey.create({ data: { garageId, ...answers } });
  const features = startingFeatures(answers);
  await tx.garageFeature.createMany({
    data: FEATURE_KEYS.map((key) => ({
      enabled: features[key],
      garageId,
      key,
    })),
  });
  await audit.recordMany(
    tx,
    FEATURE_KEYS.map((key) => ({
      action: 'create' as const,
      actorId,
      actorRole: 'garage' as const,
      field: key,
      garageId,
      newValue: features[key],
      subjectId: garageId,
      subjectType: 'garage_feature',
    })),
  );
}
