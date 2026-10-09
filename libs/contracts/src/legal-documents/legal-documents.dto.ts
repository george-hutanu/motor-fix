import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { DOCUMENT_KINDS, type DocumentKind } from './legal-documents';
import {
  ConfirmPhotoDto,
  PhotoUploadAddressDto,
  PhotoUploadRequestDto,
} from '../listing-photos/listing-photos.dto';

// The same upload as a listing photo's, under names of their own.
export class DocumentUploadRequestDto extends PhotoUploadRequestDto {}

export class DocumentUploadAddressDto extends PhotoUploadAddressDto {}

export class ConfirmDocumentPageDto extends ConfirmPhotoDto {}

export class DraftDocumentDto {
  @ApiProperty({ enum: DOCUMENT_KINDS })
  kind!: DocumentKind;

  @ApiProperty({ description: 'Storage keys in page order', type: [String] })
  pages!: string[];

  @ApiPropertyOptional({ example: '2026-10-01', format: 'date' })
  issuedOn?: string;
}

export class DocumentPageAddressDto {
  @ApiProperty({ description: 'Signed for 5 minutes, opens inline' })
  url!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;
}
