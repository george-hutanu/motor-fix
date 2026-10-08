import { ApiProperty } from '@nestjs/swagger';
import { IsDefined } from 'class-validator';

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

export class PlatformStatusDto {
  @ApiProperty({ description: 'The platform is in maintenance' })
  maintenance!: boolean;
}
