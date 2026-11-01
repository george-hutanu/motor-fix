import { ApiProperty } from '@nestjs/swagger';

import {
  type StatusTexts,
  TILES,
  type TileKey,
  type TileState,
} from './status-tiles';

export class StatusTextsDto implements StatusTexts {
  @ApiProperty()
  ro!: string;

  @ApiProperty()
  en!: string;
}

export class StatusSentencesDto {
  @ApiProperty({ type: [String] })
  ro!: string[];

  @ApiProperty({ type: [String] })
  en!: string[];
}

export class StatusTileDto {
  @ApiProperty({ enum: TILES })
  key!: TileKey;

  @ApiProperty({ enum: ['green', 'amber', 'red'] })
  state!: TileState;

  @ApiProperty({
    description:
      'Since when the tile is in its state; for a stale tile, its last check',
    format: 'date-time',
    nullable: true,
    type: String,
  })
  since!: string | null;

  @ApiProperty({
    additionalProperties: { oneOf: [{ type: 'number' }, { type: 'string' }] },
    description: 'The figures the last check stored',
    type: 'object',
  })
  detail!: Record<string, number | string>;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  checkedAt!: string | null;

  @ApiProperty({ description: 'No check for three minutes: answered red' })
  stale!: boolean;

  @ApiProperty({ type: StatusTextsDto })
  short!: StatusTextsDto;
}

export class AdminStatusDto {
  @ApiProperty({ maxItems: 6, minItems: 6, type: [StatusTileDto] })
  tiles!: StatusTileDto[];

  @ApiProperty({
    description: 'The tiles not green: red first, the oldest first',
    enum: TILES,
    isArray: true,
  })
  problems!: TileKey[];

  @ApiProperty({ type: StatusSentencesDto })
  sentences!: StatusSentencesDto;
}
