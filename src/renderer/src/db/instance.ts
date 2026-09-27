import { createRxDatabase } from 'rxdb'
import type { RxCollection, RxDatabase, RxDocument } from 'rxdb'
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie'
import { artifactSchema, commentSchema, reviewSchema, taskSchema } from '@shared/store/schema'
import type { ArtifactDoc, CommentDoc, ReviewDoc, TaskDoc } from '@shared/store/schema'
import type { SuperPiCollections } from '@shared/store/repo'

/**
 * Renderer-owned RxDB (Dexie/IndexedDB). Created once outside React and
 * provided to the tree; all domain data flows through live queries.
 */

export type RendererDatabase = RxDatabase<SuperPiCollections>

let dbPromise: Promise<RendererDatabase> | null = null

export function getDatabase(): Promise<RendererDatabase> {
  if (!dbPromise) {
    // no ignoreDuplicate here: it throws DB9 outside RxDB dev-mode, and the
    // module-level promise already guarantees a single instance per process
    dbPromise = createRxDatabase<SuperPiCollections>({
      name: 'super-pi',
      storage: getRxStorageDexie()
    }).then((db) =>
      db
        .addCollections({
          tasks: { schema: taskSchema as never },
          artifacts: { schema: artifactSchema as never },
          reviews: { schema: reviewSchema as never },
          comments: { schema: commentSchema as never }
        })
        .then(() => db)
    )
  }
  return dbPromise
}

export type { SuperPiCollections, TaskDoc, ArtifactDoc, ReviewDoc, CommentDoc }
export type { RxCollection, RxDatabase, RxDocument }
