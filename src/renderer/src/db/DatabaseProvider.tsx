import type { ReactNode } from 'react'
import { RxDatabaseProvider } from 'rxdb/plugins/react'
import type { RendererDatabase } from './instance'

/**
 * Provides the renderer-wide RxDatabase to the React tree. Must receive the
 * RESOLVED database instance — RxDatabaseProvider validates with
 * isRxDatabase and throws (R1) when handed the creation promise.
 */
export function DatabaseProvider({
  db,
  children
}: {
  db: RendererDatabase
  children: ReactNode
}): React.JSX.Element {
  return <RxDatabaseProvider database={db as never}>{children}</RxDatabaseProvider>
}
