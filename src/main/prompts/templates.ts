import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/**
 * Resolve superpowers reviewer-prompt templates. Priority: newest installed
 * plugin version (globbed at runtime) → app-vendored copies in
 * resources/prompts/ so agentic review never depends on the plugin layout.
 */

export const REVIEWER_TEMPLATES = [
  'spec-document-reviewer-prompt.md',
  'plan-document-reviewer-prompt.md',
  'code-reviewer.md'
] as const

export type ReviewerTemplate = (typeof REVIEWER_TEMPLATES)[number]

function vendoredDir(): string {
  // electron-vite bundles main to out/main; resources/ stays at app root
  return join(process.cwd(), 'resources', 'prompts')
}

/** Newest `claude-plugins-official___superpowers___<ver>` skills dir, or null. */
export function resolveSuperpowersSkillsDir(): string | null {
  const base =
    process.env['SUPER_PI_SKILLS_BASE'] ?? join(homedir(), '.omp', 'plugins', 'cache', 'plugins')
  let entries: string[]
  try {
    entries = readdirSync(base)
  } catch {
    return null
  }
  const dirs = entries
    .filter((d) => d.startsWith('claude-plugins-official___superpowers___'))
    .sort((a, b) => {
      const va = a.split('___')[2] ?? ''
      const vb = b.split('___')[2] ?? ''
      const [ma = 0, mia = 0, pa = 0] = va.split('.').map(Number)
      const [mb = 0, mib = 0, pb = 0] = vb.split('.').map(Number)
      return ma - mb || mia - mib || pa - pb
    })
  const newest = dirs.at(-1)
  return newest ? join(base, newest, 'skills') : null
}

export function fillTemplate(template: string, placeholders: Record<string, string>): string {
  let out = template
  for (const [key, value] of Object.entries(placeholders)) {
    out = out.replaceAll(`[${key}]`, value)
  }
  return out
}

export function loadReviewerTemplate(name: ReviewerTemplate): string {
  const skills = resolveSuperpowersSkillsDir()
  if (skills) {
    const pluginPath = join(
      skills,
      name === 'code-reviewer.md'
        ? 'requesting-code-review'
        : name === 'spec-document-reviewer-prompt.md'
          ? 'brainstorming'
          : 'writing-plans',
      name
    )
    try {
      return readFileSync(pluginPath, 'utf8')
    } catch {
      // fall through to vendored copy
    }
  }
  return readFileSync(join(vendoredDir(), name), 'utf8')
}
