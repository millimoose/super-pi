import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { RxDatabaseProvider } from 'rxdb/plugins/react'
import { getDatabase } from './instance'

/** Provides the renderer-wide RxDatabase to the React tree. */
export function DatabaseProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const db = useMemo(() => getDatabase(), [])
  return <RxDatabaseProvider database={db as never}>{children}</RxDatabaseProvider>
}
