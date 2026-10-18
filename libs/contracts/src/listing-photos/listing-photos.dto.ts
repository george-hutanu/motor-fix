import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsString, Matches, MaxLength, Min } from 'class-validator';

export class PhotoUploadRequestDto {
  @ApiProperty({ example: 'image/jpeg' })
  @IsString()
  @MaxLength(100)
  contentType!: string;

  @ApiProperty({ description: 'Bytes', minimum: 1 })
  @IsInt()
  @Min(1)
  size!: number;

  @ApiProperty({
    description: 'Base64 of the CRC32 of the file, big-endian',
    example: 'yPQ5Jg==',
  })
  @IsString()
  // Four bytes: five free characters, a sixth whose low four bits are zero.
  @Matches(/^[A-Za-z0-9+/]{5}[AQgw]==$/)
  checksum!: string;
}

export class PhotoUploadAddressDto {
  @ApiProperty({ description: 'Where the browser PUTs the file' })
  url!: string;

  @ApiProperty({
    additionalProperties: { type: 'string' },
    description: 'Headers to send with the PUT, exactly as given',
    type: 'object',
  })
  headers!: Record<string, string>;

  @ApiProperty({ description: 'The key to confirm once uploaded' })
  key!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;
}

export class ConfirmPhotoDto {
  @ApiProperty({ description: 'The key the upload address gave' })
  @IsString()
  @MaxLength(200)
  key!: string;
}

export class ListingPhotoDto {
  @ApiProperty()
  key!: string;

  @ApiProperty({ description: '0 is the cover' })
  position!: number;

  @ApiProperty({ description: 'Whether the thumbnail is ready' })
  processed!: boolean;

  @ApiPropertyOptional()
  width?: number;

  @ApiPropertyOptional()
  height?: number;

  @ApiPropertyOptional({ description: 'Signed for 5 minutes' })
  thumbnailUrl?: string;
}

export class ListingPhotosDto {
  @ApiProperty({ type: [ListingPhotoDto] })
  photos!: ListingPhotoDto[];
}
