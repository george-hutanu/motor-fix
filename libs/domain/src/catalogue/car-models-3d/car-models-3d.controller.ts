import {
  CarModel3dDto,
  CarModels3dQueryDto,
  IMMUTABLE,
} from '@motor-fix/contracts';
import {
  Controller,
  Get,
  HttpStatus,
  Param,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { MODEL_3D_KEY } from './car-models-3d';
import { CarModels3dService } from './car-models-3d.service';
import { CurrentActor, OptionalActor, Public } from '../../auth/actor.guard';
import { notFound, refusal } from '../../auth/http-refusal';
import type { Actor } from '../../auth/policy';
import { PublicCache } from '../../cache/http-cache/http-cache.interceptor';
import { StorageService } from '../../storage/storage.service';
import { MODEL_3D_FILES } from '../models-3d/models-3d';

const MODEL_3D_KEYS = new Set(MODEL_3D_FILES.map((f) => f.file));

@ApiTags('catalogue')
@Controller('car-models-3d')
export class CarModels3dController {
  constructor(
    private readonly models: CarModels3dService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  @Public()
  @OptionalActor()
  @PublicCache()
  @ApiOkResponse({
    description:
      "The 3D car to show for the brand: the driver's own licensed car, else the brand's most popular licensed model, else its generic shape",
    type: CarModel3dDto,
  })
  @ApiBadRequestResponse({
    description:
      'validation_failed: brand or car is missing, malformed or repeated',
  })
  @ApiNotFoundResponse({
    description:
      "not_found: no active brand has this key, or car is not the caller's own",
  })
  read(
    @Query() query: CarModels3dQueryDto,
    @CurrentActor() actor?: Actor,
  ): Promise<CarModel3dDto> {
    return this.models.read(query, actor?.accountId);
  }

  // A file's key names its content, so an answer is cached for a year;
  // anything else, refusals included, is never cached. Only the exact address
  // is served: Express's routing ignores case and a trailing slash.
  @Get('files/:key')
  @Public()
  @ApiOperation({ operationId: 'getCarModel3dFile' })
  @ApiProduces('model/gltf-binary')
  @ApiOkResponse({ description: 'The GLB, cached for a year' })
  @ApiNotFoundResponse({
    description: 'not_found: the catalogue or the store has no such file',
  })
  @ApiServiceUnavailableResponse({
    description: 'storage_unavailable: the object store did not answer',
  })
  async file(
    @Param('key') key: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    res.setHeader('Cache-Control', 'no-store');
    if (
      !MODEL_3D_KEY.test(key) ||
      !MODEL_3D_KEYS.has(key) ||
      !req.path.endsWith(`/car-models-3d/files/${key}`)
    ) {
      throw notFound();
    }
    const stored = await this.storage
      .readStored(`models-3d/${key}`)
      .catch(() => {
        throw refusal(
          HttpStatus.SERVICE_UNAVAILABLE,
          'storage_unavailable',
          'The 3D file store did not answer',
        );
      });
    if (!stored) throw notFound();
    res.setHeader('Cache-Control', IMMUTABLE);
    return new StreamableFile(stored.body, { type: 'model/gltf-binary' });
  }
}
