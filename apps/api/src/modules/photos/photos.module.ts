import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { SyncModule, SyncRegistry } from '../sync/index.js';
import { PhotoRepository } from './photo.repository.js';

/** Registers the photo handler with the sync registry (ADR 0002: each module registers its own). */
@Injectable()
class PhotosService implements OnModuleInit {
  constructor(
    private readonly registry: SyncRegistry,
    private readonly photos: PhotoRepository,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.photos);
  }
}

/**
 * Colour photos (ADR 0009). They travel by sync like any record; there is no REST route: the
 * image is a field of the record, validated by the same photoSchema on the device and here.
 */
@Module({
  imports: [SyncModule],
  providers: [PhotoRepository, PhotosService],
})
export class PhotosModule {}
