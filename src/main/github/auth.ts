import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Why a token source is unavailable (surface for diagnostics, not control flow). */
export type TokenSource = 'gh' | 'env'

/**
 * Resolve the GitHub token: `gh auth token` subprocess → GITHUB_TOKEN env.
 * Returns undefined when no source works — callers degrade to local-only mode.
 */
export async function resolveToken(): Promise<
  { token: string; source: TokenSource } | undefined
> {
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token'])
    const token = stdout.trim()
    if (token) return { token, source: 'gh' }
  } catch {
    // gh missing or unauthenticated — fall through
  }
  const env = process.env['GITHUB_TOKEN']
  if (env) return { token: env, source: 'env' }
  return undefined
}

export async function hasToken(): Promise<boolean> {
  return (await resolveToken()) !== undefined
}
