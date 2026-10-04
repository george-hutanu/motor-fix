import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional, IsUUID, Matches } from 'class-validator';

export const AUDIT_AREAS = [
  'requests',
  'quotes',
  'bookings',
  'jobs',
  'prices',
  'repair_history',
  'photos',
  'garage_profile',
  'team',
  'settings',
  'admin_actions',
] as const;
export type AuditArea = (typeof AUDIT_AREAS)[number];

const ACTOR_ROLES = [
  'driver',
  'owner',
  'receptionist',
  'mechanic',
  'admin',
  'system',
] as const;

// An instant, never a calendar day: the view turns local days into instants.
const INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const instantMessage = '$property must be a date-time with a zone';

// Stored values are free JSON: text, numbers, objects or lists.
const JSON_VALUE = {
  description: 'The value as stored (money in bani, times in UTC)',
  nullable: true,
  oneOf: [
    { type: 'string' },
    { type: 'number' },
    { type: 'boolean' },
    { type: 'object' },
    { items: {}, type: 'array' },
  ],
};

export class AuditHistoryQueryDto {
  @ApiPropertyOptional({
    description: 'Staff: their own garage only; admin: any garage',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  garageId?: string;

  @ApiPropertyOptional({ description: 'Who made the change', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  jobId?: string;

  @ApiPropertyOptional({ enum: AUDIT_AREAS })
  @IsOptional()
  @IsIn(AUDIT_AREAS)
  area?: AuditArea;

  @ApiPropertyOptional({
    description: 'Inclusive; 7 days before now when absent',
    format: 'date-time',
  })
  @IsOptional()
  @Matches(INSTANT, { message: instantMessage })
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({ description: 'Inclusive', format: 'date-time' })
  @IsOptional()
  @Matches(INSTANT, { message: instantMessage })
  @IsISO8601({ strict: true })
  to?: string;

  @ApiPropertyOptional({
    description: 'The nextCursor of the previous page',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  cursor?: string;
}

export class AuditActorDto {
  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  id!: string | null;

  @ApiProperty({ description: 'First name, or "MotorFix" for the system' })
  name!: string;

  @ApiProperty({ enum: ACTOR_ROLES })
  role!: (typeof ACTOR_ROLES)[number];
}

export class AuditEntryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'date-time' })
  at!: string;

  @ApiProperty({ enum: ['create', 'update', 'delete', 'open'] })
  action!: 'create' | 'update' | 'delete' | 'open';

  @ApiProperty({ description: 'The table the entry is about, e.g. quote' })
  subjectType!: string;

  @ApiProperty({ format: 'uuid' })
  subjectId!: string;

  @ApiProperty({ nullable: true, type: String })
  field!: string | null;

  @ApiProperty(JSON_VALUE)
  oldValue!: unknown;

  @ApiProperty(JSON_VALUE)
  newValue!: unknown;

  @ApiProperty({ type: AuditActorDto })
  actor!: AuditActorDto;

  @ApiProperty()
  viaAssistant!: boolean;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  garageId!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  carId!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  jobId!: string | null;

  @ApiProperty({ description: 'Never shown to the driver' })
  internal!: boolean;

  @ApiProperty({ nullable: true, type: String })
  kind!: string | null;

  @ApiProperty({ nullable: true, type: String })
  text!: string | null;
}

export class AuditHistoryPageDto {
  @ApiProperty({
    description: 'Newest first, 20 at most',
    type: [AuditEntryDto],
  })
  items!: AuditEntryDto[];

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  nextCursor!: string | null;

  @ApiProperty({ description: 'Entries matching the filters' })
  total!: number;
}
