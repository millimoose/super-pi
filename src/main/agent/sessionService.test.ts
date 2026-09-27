import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { simpleGit } from 'simple-git'
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory'
import { createSuperPiDatabase } from '@shared/store/database'
import type { SuperPiDatabase } from '@shared/store/repo'
import {
  advanceTask,
  createTask,
  latestArtifact,
  recordArtifact,
  recordReview
} from '@shared/store/repo'
import { SessionService } from './sessionService'
import { deterministicTitleSlug, generateTitleSlug } from './titleSlugService'

const FAKE_OMP = join(process.cwd(), 'resources', 'test', 'fake-omp.mjs')
// spawn node directly — .cmd shims require shell:true (Node EINVAL)
const NODE = process.execPath

const dirs: string[] = []
const dbs: SuperPiDatabase[] = []

afterEach(async () => {
  while (dbs.length) {
    const db = dbs.pop() as SuperPiDatabase
    await db.remove()
  }
  while (dirs.length) await rm(dirs.pop() as string, { recursive: true, force: true })
})

/** Temp git repo + memory db. Fake mode is set per-service via env. */
async function makeEnv(): Promise<{ db: SuperPiDatabase; repo: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'super-pi-agent-'))
  dirs.push(dir)
  const git = simpleGit(dir)
  await git.init(['-b', 'main'])
  await git.addConfig('user.email', 't@t')
  await git.addConfig('user.name', 't')
  await writeFile(join(dir, 'seed.md'), 'seed\n')
  await git.add('-A')
  await git.commit('seed')

  const db = await createSuperPiDatabase(
    `agent-test-${Math.random().toString(36).slice(2)}`,
    getRxStorageMemory()
  )
  dbs.push(db)
  return { db, repo: dir }
}

const taskInput = {
  id: 'task-1',
  title: 'Add dark mode',
  origin: 'prompt' as const,
  prompt: 'dark mode please',
  repoPath: 'irrelevant',
  githubOwner: 'octo',
  githubRepo: 'x',
  trackerKind: 'github' as const,
  issueId: '42',
  issueTitle: 'Add dark mode',
  issueUrl: 'https://github.com/octo/x/issues/42',
  slug: 'add-dark-mode',
  branch: 'task/42-add-dark-mode'
}

describe('sessionService over fake-omp', () => {
  it('drives a full intake → spec_human_review run via host tool', async () => {
    const { db, repo } = await makeEnv()
    const appData = await mkdtemp(join(tmpdir(), 'super-pi-data-'))
    dirs.push(appData)
    const service = new SessionService({ ompBin: NODE, ompArgs: [FAKE_OMP], env: { SUPER_PI_FAKE_MODE: 'rpc' }, appDataDir: appData })
    const task = await createTask(db, { ...taskInput })

    await advanceTask(db, task.id, 'start')
    const frames: Array<Record<string, unknown>> = []
    const outcome = await service.startStage(
      task.id,
      { worktreePath: repo, prompt: 'brainstorm the spec' },
      { onFrame: (f) => frames.push(f) }
    )
    expect(outcome.kind).toBe('stage')
    if (outcome.kind !== 'stage') return
    expect(outcome.result.status).toBe('complete')
    expect(outcome.result.artifactPath).toBe('docs/superpowers/spec.md')

    await recordArtifact(db, { id: 'a1', taskId: task.id, kind: 'spec', path: 'docs/superpowers/spec.md' })
    expect(await advanceTask(db, task.id, 'stage_complete')).toBe('spec_agent_review')

    const reviewOutcome = await service.startStage(task.id, {
      worktreePath: repo,
      prompt: 'review the spec'
    })
    expect(reviewOutcome.kind).toBe('stage')

    await recordReview(db, {
      id: 'r1',
      artifactId: 'a1',
      source: 'agent',
      verdict: 'approved',
      summary: 'fake review ok',
      comments: [{ anchor: null, body: 'looks fine' }]
    })
    expect(await advanceTask(db, task.id, 'agent_review_complete')).toBe('spec_human_review')
    expect((await latestArtifact(db, task.id, 'spec'))?.status).toBe('human_review')
    expect(frames.some((f) => f.type === 'message_update')).toBe(true)
  }, 60_000)

  it('falls back to the marker file when no host tool is called', async () => {
    const { repo } = await makeEnv()
    const appData = await mkdtemp(join(tmpdir(), 'super-pi-data-'))
    dirs.push(appData)
    const service = new SessionService({ ompBin: NODE, ompArgs: [FAKE_OMP], env: { SUPER_PI_FAKE_MODE: 'rpc-marker' }, appDataDir: appData })
    const outcome = await service.startStage('t-marker', {
      worktreePath: repo,
      prompt: 'produce the artifact'
    })
    expect(outcome.kind, JSON.stringify(outcome)).toBe('stage')
    if (outcome.kind === 'stage') expect(outcome.result.status).toBe('complete')
  }, 60_000)

  it('reports failure with transcript when the child exits early', async () => {
    const { repo } = await makeEnv()
    const appData = await mkdtemp(join(tmpdir(), 'super-pi-data-'))
    dirs.push(appData)
    const service = new SessionService({ ompBin: NODE, ompArgs: [FAKE_OMP], env: { SUPER_PI_FAKE_MODE: 'rpc-exit' }, appDataDir: appData })
    const outcome = await service.startStage('t-exit', {
      worktreePath: repo,
      prompt: 'do work'
    })
    expect(outcome.kind).toBe('failure')
    if (outcome.kind === 'failure') {
      expect(outcome.error).toMatch(/exited|settling/)
      expect(Array.isArray(outcome.transcript)).toBe(true)
    }
  }, 60_000)
})

describe('titleSlugService over fake-omp -p', () => {
  it('parses well-formed JSON output', async () => {
    await makeEnv()
    const result = await generateTitleSlug('we need a dark mode', {
      ompBin: NODE,
      ompArgs: [FAKE_OMP],
      env: { SUPER_PI_FAKE_MODE: 'print-ok' },
      cwd: '.'
    })
    expect(result).toEqual({ title: 'Dark mode toggle', slug: 'dark-mode-toggle' })
  }, 60_000)

  it('falls back deterministically on prose output', async () => {
    await makeEnv()
    const prompt = 'Add Export annotations & a CSV download link'
    const result = await generateTitleSlug(prompt, {
      ompBin: NODE,
      ompArgs: [FAKE_OMP],
      env: { SUPER_PI_FAKE_MODE: 'print-bad' },
      cwd: '.'
    })
    expect(result).toEqual(deterministicTitleSlug(prompt))
    expect(result.slug).toMatch(/^[a-z0-9-]+$/)
  }, 60_000)

  it('deterministic fallback trims at word boundaries and kebab-slugs ≤8 words', () => {
    const long =
      'This is a very long prompt that keeps going well past the seventy character limit for sure yes'
    const { title, slug } = deterministicTitleSlug(long)
    expect(title.length).toBeLessThanOrEqual(70)
    expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    expect(slug.split('-').length).toBeLessThanOrEqual(8)
  })

  it('never returns an empty title or slug', () => {
    expect(deterministicTitleSlug('   ')).toEqual({ title: 'task', slug: 'task' })
  })
})
