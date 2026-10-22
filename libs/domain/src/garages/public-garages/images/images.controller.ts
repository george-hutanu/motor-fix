import {
  Controller,
  Get,
  HttpStatus,
  Param,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { Public } from '../../../auth/actor.guard';
import { refusal } from '../../../auth/sign-up.service';
import { StorageService } from '../../../storage/storage.service';
import { PublicGaragesService } from '../public-garages';

const OWNER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const FILE = /^(320|640|960|1600)\.(avif|webp)$/;
const IMMUTABLE = 'public, max-age=31536000, immutable';

const notFound = () => refusal(HttpStatus.NOT_FOUND, 'not_found', 'Not found');

// The responsive copies of a listed garage's photos. The address is fixed by
// the photo's content, so an answer is cached for a year; anything else,
// refusals included, is never cached. A malformed address is refused before
// the database or the store is asked.
@ApiTags('garages')
@Controller('images')
export class ImagesController {
  constructor(
    private readonly garages: PublicGaragesService,
    private readonly storage: StorageService,
  ) {}

  @Public()
  @Get('g/:owner/:digest/:file')
  @ApiOperation({ operationId: 'getImageVariant' })
  @ApiProduces('image/avif', 'image/webp')
  @ApiOkResponse({ description: 'The variant, cached for a year' })
  @ApiNotFoundResponse({
    description: 'not_found: no listed garage shows a photo at this address',
  })
  @ApiServiceUnavailableResponse({
    description: 'storage_unavailable: the object store did not answer',
  })
  async variant(
    @Param('owner') owner: string,
    @Param('digest') digest: string,
    @Param('file') file: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    res.setHeader('Cache-Control', 'no-store');
    if (!OWNER.test(owner) || !DIGEST.test(digest) || !FILE.test(file)) {
      throw notFound();
    }
    const path = `g/${owner}/${digest}`;
    const garageId = await this.garages.variantHolder(path);
    if (!garageId) throw notFound();
    const stored = await this.storage
      .readStored(`${path}/${file}`)
      .catch(() => {
        throw refusal(
          HttpStatus.SERVICE_UNAVAILABLE,
          'storage_unavailable',
          'The photo store did not answer',
        );
      });
    if (!stored) throw notFound();
    res.setHeader('Cache-Control', IMMUTABLE);
    res.setHeader('CDN-Tag', `garage:${garageId}`);
    return new StreamableFile(stored.body, { type: stored.contentType });
  }
}
