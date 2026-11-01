import { IMMUTABLE } from '@motor-fix/contracts';
import { Injectable, Logger } from '@nestjs/common';

import { MODEL_3D_FILES, placeholders } from './models-3d';
import { StorageService } from '../../storage/storage.service';

// Puts every catalogue 3D file the store lacks under models-3d/, once: a key
// names its content, so one that exists is never written again. A failure
// leaves the rest for the next start and never stops this one.
@Injectable()
export class Models3dStore {
  private readonly logger = new Logger('Models3dStore');

  constructor(private readonly storage: StorageService) {}

  async fill(): Promise<{ written: number }> {
    let written = 0;
    try {
      const missing = await this.missing();
      const bytes = await this.bytesFor(missing);
      for (const file of missing) {
        const body = bytes.get(file);
        if (!body) throw new Error(`no bytes for the 3D file ${file}`);
        await this.storage.putObject(
          `models-3d/${file}`,
          body,
          'model/gltf-binary',
          undefined,
          IMMUTABLE,
        );
        written += 1;
      }
      this.logger.log(`3D files uploaded: ${written} written`);
    } catch (error) {
      this.logger.error(
        `3D files upload failed after ${written} written`,
        error instanceof Error ? error.stack : String(error),
      );
    }
    return { written };
  }

  private async missing(): Promise<string[]> {
    const missing: string[] = [];
    for (const { file } of MODEL_3D_FILES) {
      if (!(await this.storage.contentTypeOf(`models-3d/${file}`)))
        missing.push(file);
    }
    return missing;
  }

  private async bytesFor(missing: string[]): Promise<Map<string, Uint8Array>> {
    const bytes = placeholders();
    if (missing.every((file) => bytes.has(file))) return bytes;
    // The generator pulls in the GLB encoder: loaded only when needed.
    const { generateGeneric } = await import('./generic/generic');
    for (const { bytes: glb, name } of await generateGeneric())
      bytes.set(name, glb);
    return bytes;
  }
}
