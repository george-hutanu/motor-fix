import type { StorageEnv } from '@motor-fix/contracts';
import { DynamicModule, Module } from '@nestjs/common';

import { STORAGE_OPTIONS, StorageService } from './storage.service';

// Global: every owning module (listing photos, documents, messages, invoices)
// injects StorageService without importing this module again.
@Module({})
export class StorageModule {
  static register(env: StorageEnv): DynamicModule {
    return {
      exports: [StorageService],
      global: true,
      module: StorageModule,
      providers: [StorageService, { provide: STORAGE_OPTIONS, useValue: env }],
    };
  }
}
