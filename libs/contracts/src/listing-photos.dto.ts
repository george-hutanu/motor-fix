import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsString, MaxLength, Min } from 'class-validator';

export class PhotoUploadRequestDto {
  @ApiProperty({ example: 'image/jpeg' })
  @IsString()
  @MaxLength(100)
  contentType!: string;

  @ApiProperty({ description: 'Bytes', minimum: 1 })
  @IsInt()
  @Min(1)
  size!: number;
}

export class PhotoUploadAddressDto {
  @ApiProperty({ description: 'Where the browser posts the form' })
  url!: string;

  @ApiProperty({
    additionalProperties: { type: 'string' },
    description: 'Form fields to send before the file',
    type: 'object',
  })
  fields!: Record<string, string>;

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
