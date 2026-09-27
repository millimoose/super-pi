import { spawn } from 'node:child_process'
import { firstJsonObject } from '@shared/agent/resultSchemas'
import { type } from 'arktype'

/**
 * Generate an issue title + slug for a prompt-origin task via `omp -p` on the
 * smol model role. Never blocks task creation: model failure, role
 * misconfiguration, or malformed output all fall back to a deterministic
 * kebab title/slug.
 */

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const TitleSlugOut = type({
  title: 'string',
  slug: 'string'
}).narrow((v) => {
  if (v.title.length === 0 || v.title.length > 70) return false
  if (v.slug.length === 0 || v.slug.length > 40) return false
  return KEBAB.test(v.slug)
})

export type TitleSlug = typeof TitleSlugOut.infer

function kebab(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function deterministicTitleSlug(prompt: string): TitleSlug {
  const trimmed = prompt.trim().replace(/\s+/g, ' ')
  let title = trimmed
  if (title.length > 70) {
    const cut = title.slice(0, 70)
    const lastSpace = cut.lastIndexOf(' ')
    title = lastSpace > 30 ? cut.slice(0, lastSpace) : cut
  }
  const slug = kebab(trimmed.split(' ').slice(0, 8).join(' ')).slice(0, 40)
  return { title: title || 'task', slug: slug || 'task' }
}

function runOmp(
  args: string[],
  options: { ompBin: string; cwd: string; env?: Record<string, string> }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.ompBin, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env }
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`omp -p exited ${code}: ${stderr.slice(0, 200)}`))
    })
  })
}

const MODEL_FAIL = /unknown model|no such model|model not found|unconfigured role|unknown role/i

export async function generateTitleSlug(
  prompt: string,
  options: {
    ompBin?: string
    ompArgs?: string[]
    env?: Record<string, string>
    cwd: string
    maxTimeSeconds?: number
  }
): Promise<TitleSlug> {
  const ompBin = options.ompBin ?? process.env['SUPER_PI_OMP_BIN'] ?? 'omp'
  const prefix = options.ompArgs ?? []
  const baseArgs = [
    ...prefix,
    '-p',
    '--no-title',
    '--max-time',
    String(options.maxTimeSeconds ?? 60)
  ]

  async function tryOnce(args: string[]): Promise<TitleSlug | null> {
    try {
      const { stdout } = await runOmp(args, { ompBin, cwd: options.cwd, env: options.env })
      const parsed = TitleSlugOut(firstJsonObject(String(stdout)))
      return parsed instanceof type.errors ? null : parsed
    } catch (e) {
      if (e instanceof Error && MODEL_FAIL.test(e.message)) throw e
      return null
    }
  }

  // smol role first; on model-resolution failure or bad output, one retry
  // without the role flag; deterministic fallback keeps task creation moving
  try {
    const viaRole = await tryOnce([...baseArgs, '--model', '@smol', prompt])
    if (viaRole) return viaRole
  } catch {
    return deterministicTitleSlug(prompt)
  }
  const viaDefault = await tryOnce([...baseArgs, prompt])
  return viaDefault ?? deterministicTitleSlug(prompt)
}
