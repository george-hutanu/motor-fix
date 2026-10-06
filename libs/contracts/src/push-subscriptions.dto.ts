import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class PushKeysDto {
  @ApiProperty({ description: 'The browser’s public key (base64url)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  p256dh!: string;

  @ApiProperty({ description: 'The browser’s auth secret (base64url)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  auth!: string;
}

export class SavePushSubscriptionDto {
  @ApiProperty({ description: 'The push service address of the browser' })
  @IsUrl({ protocols: ['https'], require_protocol: true, require_tld: false })
  @MaxLength(2048)
  endpoint!: string;

  @ApiProperty({ type: PushKeysDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys!: PushKeysDto;

  @ApiPropertyOptional({ description: 'The browser’s own description' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;
}

export class PushSubscriptionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
}

export class PushKeyDto {
  @ApiProperty({
    description: 'The server’s VAPID public key; null when push is off',
    nullable: true,
    type: String,
  })
  publicKey!: string | null;
}

export class PushTestQueuedDto {
  @ApiProperty({ description: 'How many test pushes were queued' })
  queued!: number;
}
