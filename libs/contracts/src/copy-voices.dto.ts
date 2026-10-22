import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDefined, ValidateNested } from 'class-validator';

// Anything but a whole 1 to 5 is dropped rather than refused: a bad voice
// never costs the visitor the request or the listing it rides on.
export const copyVoiceOrUndefined = ({ value }: { value: unknown }) =>
  Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 5
    ? value
    : undefined;

export class CopyVoiceStateDto {
  @ApiProperty({ description: 'Visitors may get this voice' })
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({ description: 'Every new visit gets this voice' })
  @IsBoolean()
  pinned!: boolean;
}

export class CopyVoiceDto extends CopyVoiceStateDto {
  @ApiProperty({ maximum: 5, minimum: 1 })
  voice!: number;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  updatedAt!: string | null;
}

export class CopyVoicesDto {
  @ApiProperty({ description: 'Voices 1 to 5, in order', type: [CopyVoiceDto] })
  voices!: CopyVoiceDto[];
}

export class ChangeCopyVoiceDto extends CopyVoiceStateDto {
  @ApiProperty({
    description: "The voice's state the admin's screen showed",
    type: CopyVoiceStateDto,
  })
  @IsDefined()
  @ValidateNested()
  @Type(() => CopyVoiceStateDto)
  seen!: CopyVoiceStateDto;
}

// What every browser reads and keeps on the device.
export class PublicCopyVoicesDto {
  @ApiProperty({
    description: 'The voices that are on, ascending',
    type: [Number],
  })
  enabled!: number[];

  @ApiProperty({ nullable: true, type: Number })
  pinned!: number | null;
}
