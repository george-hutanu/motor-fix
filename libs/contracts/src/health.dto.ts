import { ApiProperty } from '@nestjs/swagger';

const CHECK = ['ok', 'error'] as const;
type Check = (typeof CHECK)[number];

export class HealthLiveDto {
  @ApiProperty({ enum: ['ok'] })
  status!: 'ok';
}

export class HealthChecksDto {
  @ApiProperty({ enum: CHECK })
  postgres!: Check;

  @ApiProperty({ enum: CHECK })
  redis!: Check;
}

export class HealthReadyDto {
  @ApiProperty({ enum: CHECK })
  status!: Check;

  @ApiProperty({ type: HealthChecksDto })
  checks!: HealthChecksDto;

  @ApiProperty({ description: 'The deployed commit SHA, or dev' })
  version!: string;
}
