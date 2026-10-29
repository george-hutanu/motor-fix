import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { ROLES, type Role } from './capabilities';

// More than any role's section list will hold; the service checks the keys.
const PANELS_MAX = 20;

export class DashboardPanelDto {
  @ApiProperty({
    description: "A section key of the role's list",
    example: 'log',
  })
  @IsString()
  @MaxLength(40)
  key!: string;

  @ApiProperty()
  @IsBoolean()
  visible!: boolean;
}

export class PutDashboardLayoutDto {
  @ApiProperty({
    description:
      'The whole layout in the order shown; a key left out comes back visible at the end',
    maxItems: PANELS_MAX,
    type: [DashboardPanelDto],
  })
  @IsArray()
  @ArrayMaxSize(PANELS_MAX)
  @ValidateNested({ each: true })
  @Type(() => DashboardPanelDto)
  panels!: DashboardPanelDto[];
}

export class DashboardLayoutDto {
  @ApiProperty({ enum: ROLES })
  role!: Role;

  @ApiProperty({
    description:
      "The saved order and visibility, then the role's newer sections, visible",
    type: [DashboardPanelDto],
  })
  panels!: DashboardPanelDto[];

  @ApiProperty({
    description: 'UTC; null while the default is shown',
    format: 'date-time',
    nullable: true,
    type: String,
  })
  updatedAt!: string | null;
}
