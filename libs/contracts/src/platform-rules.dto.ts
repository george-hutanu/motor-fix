import { ApiProperty } from '@nestjs/swagger';
import { Allow, IsDefined } from 'class-validator';

// A rule's value is JSON of its default's type: boolean for the switches,
// a number or an object for rules added later to the same store.
const RULE_VALUE = {
  oneOf: [
    { type: 'boolean' },
    { type: 'number' },
    { type: 'string' },
    { type: 'object' },
  ],
};

export class PlatformRuleDto {
  @ApiProperty({ example: 'maintenance_mode' })
  key!: string;

  @ApiProperty(RULE_VALUE)
  value!: unknown;

  @ApiProperty(RULE_VALUE)
  defaultValue!: unknown;

  @ApiProperty({ description: 'Switching it off needs a second admin' })
  requiresTwoAdmins!: boolean;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  updatedBy!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  updatedAt!: string | null;
}

export class PlatformRulesDto {
  @ApiProperty({ description: 'The server runs in production' })
  production!: boolean;

  @ApiProperty({ type: [PlatformRuleDto] })
  rules!: PlatformRuleDto[];
}

export class ChangePlatformRuleDto {
  @ApiProperty({ ...RULE_VALUE, description: 'The new value' })
  @IsDefined()
  value!: unknown;

  @ApiProperty({
    ...RULE_VALUE,
    description: "The value the admin's screen showed",
  })
  @IsDefined()
  seen!: unknown;
}

export const PLATFORM_RULE_CHANGE_STATUSES = [
  'requested',
  'approved',
  'refused',
  'cancelled',
] as const;
export type PlatformRuleChangeStatus =
  (typeof PLATFORM_RULE_CHANGE_STATUSES)[number];

// The reason is checked by the service, after the rule: an unknown rule
// answers 404 before a short reason answers 400.
export class RequestPlatformRuleChangeDto {
  @ApiProperty({ example: 'reviews_only_after_confirmed_job' })
  @Allow()
  key!: string;

  @ApiProperty({ maxLength: 300, minLength: 5 })
  @Allow()
  reason!: string;
}

export class PlatformRuleChangeDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'reviews_only_after_confirmed_job' })
  key!: string;

  @ApiProperty({ enum: PLATFORM_RULE_CHANGE_STATUSES })
  status!: PlatformRuleChangeStatus;

  @ApiProperty()
  reason!: string;

  @ApiProperty({ description: "The asker's first name" })
  requestedByName!: string;

  @ApiProperty({ format: 'date-time' })
  requestedAt!: string;

  @ApiProperty({ description: 'The caller asked it' })
  mine!: boolean;

  @ApiProperty({ nullable: true, type: String })
  decidedByName!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  decidedAt!: string | null;
}

export class PlatformRuleChangesDto {
  @ApiProperty({ nullable: true, type: PlatformRuleChangeDto })
  waiting!: PlatformRuleChangeDto | null;

  @ApiProperty({
    description: 'The last five decided, newest first',
    type: [PlatformRuleChangeDto],
  })
  decided!: PlatformRuleChangeDto[];
}

export class PlatformStatusDto {
  @ApiProperty({ description: 'The platform is in maintenance' })
  maintenance!: boolean;
}
