import { createRxDatabase, type RxDatabase } from 'rxdb'
import { artifactSchema, commentSchema, reviewSchema, taskSchema } from './schema'
import type { SuperPiCollections, SuperPiDatabase } from './repo'

export type { RxDatabase, SuperPiCollections, SuperPiDatabase }

/**
 * Wire the four collections onto a fresh RxDatabase.
 * Renderer passes Dexie storage + the app database name; tests pass memory
 * storage + a unique name per instance.
 */
export async function createSuperPiDatabase(
  name: string,
  storage: Parameters<typeof createRxDatabase>[0]['storage']
): Promise<SuperPiDatabase> {
  const db = await createRxDatabase<SuperPiCollections>({
    name,
    storage
  })
  await db.addCollections({
    tasks: { schema: taskSchema },
    artifacts: { schema: artifactSchema },
    reviews: { schema: reviewSchema },
    comments: { schema: commentSchema }
  })
  return db
}
