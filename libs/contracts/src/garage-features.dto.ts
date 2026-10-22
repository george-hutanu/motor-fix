import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SetGarageFeatureDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;
}

export class GarageFeatureSwitchesDto {
  @ApiProperty()
  team_mechanics!: boolean;

  @ApiProperty()
  lift_schedule!: boolean;

  @ApiProperty()
  live_media!: boolean;

  @ApiProperty()
  day_sheets!: boolean;

  @ApiProperty()
  whatsapp!: boolean;
}

export class GarageFeaturesDto {
  @ApiProperty({ type: GarageFeatureSwitchesDto })
  features!: GarageFeatureSwitchesDto;
}
