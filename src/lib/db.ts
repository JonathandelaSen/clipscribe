import Dexie, { type EntityTable } from 'dexie';
import type { CreatorShortProjectRecord } from '@/lib/creator/storage';
import type { AssetTranscriptRecord, ContentProjectRecord, ProjectAssetRecord, ProjectExportRecord } from '@/lib/projects/types';

// Subclass Dexie to provide types
export class AudioTranscriberDB extends Dexie {
  projects!: EntityTable<ContentProjectRecord, 'id'>;
  projectAssets!: EntityTable<ProjectAssetRecord, 'id'>;
  assetTranscripts!: EntityTable<AssetTranscriptRecord, 'assetId'>;
  projectShorts!: EntityTable<CreatorShortProjectRecord, 'id'>;
  projectExports!: EntityTable<ProjectExportRecord, 'id'>;

  constructor() {
    super('ClipScribeProjectsDB');

    this.version(1).stores({
      projects: 'id, updatedAt, createdAt, lastOpenedAt, status, aspectRatio, activeSourceAssetId',
      projectAssets: 'id, projectId, createdAt, updatedAt, kind, role, origin',
      assetTranscripts: 'assetId, projectId, updatedAt, timestamp',
      projectShorts: 'id, projectId, sourceAssetId, updatedAt, createdAt, status, platform',
      projectExports: 'id, projectId, shortProjectId, sourceAssetId, outputAssetId, createdAt, status, kind'
    });

    this.version(2)
      .stores({
        projects: 'id, updatedAt, createdAt, lastOpenedAt, status, aspectRatio, activeSourceAssetId',
        projectAssets: 'id, projectId, createdAt, updatedAt, kind, role, origin',
        assetTranscripts: 'assetId, projectId, updatedAt, timestamp',
        projectShorts:
          'id, projectId, sourceAssetId, updatedAt, createdAt, status, platform, origin, suggestionGenerationId, suggestionSourceSignature',
        projectExports: 'id, projectId, shortProjectId, sourceAssetId, outputAssetId, createdAt, status, kind'
      })
      .upgrade((tx) => {
        return tx
          .table('projectShorts')
          .toCollection()
          .modify((record: { origin?: string }) => {
            if (!record.origin) {
              record.origin = 'manual';
            }
          });
      });
  }
}

void Dexie.delete('AudioTranscriberDB').catch(() => {
  // Best-effort cleanup of the legacy schema. The new DB is authoritative.
});

export const db = new AudioTranscriberDB();
