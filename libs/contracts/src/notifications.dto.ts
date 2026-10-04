import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsUUID,
} from 'class-validator';

export class TestMessageDto {
  @ApiProperty({
    description: 'The accounts that get the test e-mail',
    format: 'uuid',
    isArray: true,
    maxItems: 20,
    minItems: 1,
    type: String,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  accountIds!: string[];
}

export class TestMessageQueuedDto {
  @ApiProperty({ description: 'How many test e-mails were queued' })
  queued!: number;
}
