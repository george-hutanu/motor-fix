import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsString, MaxLength, Min } from 'class-validator';

import { DOCUMENT_KINDS, type DocumentKind } from './legal-documents';

export class DocumentUploadRequestDto {
  @ApiProperty({ example: 'application/pdf' })
  @IsString()
  @MaxLength(100)
  contentType!: string;

  @ApiProperty({ description: 'Bytes', minimum: 1 })
  @IsInt()
  @Min(1)
  size!: number;
}

export class DocumentUploadAddressDto {
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

export class ConfirmDocumentPageDto {
  @ApiProperty({ description: 'The key the upload address gave' })
  @IsString()
  @MaxLength(200)
  key!: string;
}

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
