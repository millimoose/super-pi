import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { simpleGit } from 'simple-git'
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory'
import { createSuperPiDatabase } from '@shared/store/database'
import type { SuperPiDatabase } from '@shared/store/repo'
import { advanceTask, createTask } from '@shared/store/repo'
import { SessionService } from './sessionService'

const FAKE_OMP = join(process.cwd(), 'resources', 'test', 'fake-omp.mjs')
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

/**
 * Degraded-mode contract (P8): a child that dies mid-stage leaves the task's
 * stage unchanged and hands back a failure with transcript — the UI offers
 * retry; nothing advances silently.
 */
describe('degraded mode: child exits mid-stage', () => {
  it('leaves the task stage unchanged and reports failure', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'super-pi-degraded-'))
    dirs.push(repo)
    const git = simpleGit(repo)
    await git.init(['-b', 'main'])
    await git.addConfig('user.email', 't@t')
    await git.addConfig('user.name', 't')
    await git.commit('seed', ['--allow-empty'])

    const db = await createSuperPiDatabase(
      `degraded-${Math.random().toString(36).slice(2)}`,
      getRxStorageMemory()
    )
    dbs.push(db)
    const appData = await mkdtemp(join(tmpdir(), 'super-pi-data-'))
    dirs.push(appData)
    const service = new SessionService({
      ompBin: NODE,
      ompArgs: [FAKE_OMP],
      env: { SUPER_PI_FAKE_MODE: 'rpc-exit' },
      appDataDir: appData
    })

    await createTask(db, {
      id: 't-degraded',
      title: 'Degraded task',
      origin: 'prompt',
      repoPath: repo,
      githubOwner: 'o',
      githubRepo: 'r',
      trackerKind: 'github',
      issueId: '1',
      issueTitle: 'x',
      issueUrl: 'u',
      slug: 'x',
      branch: 'task/1-x',
      worktreePath: repo
    })
    await advanceTask(db, 't-degraded', 'start') // brainstorming

    const outcome = await service.startStage('t-degraded', {
      worktreePath: repo,
      prompt: 'doomed run'
    })

    expect(outcome.kind).toBe('failure')
    if (outcome.kind === 'failure') {
      // the child may die before emitting any frames — transcript can be empty
      expect(outcome.error).toMatch(/exited|settling/)
      expect(Array.isArray(outcome.transcript)).toBe(true)
    }
    // stage unchanged — retry is the only way forward
    expect((await db.collections.tasks.findOne('t-degraded').exec())?.stage).toBe('brainstorming')
  }, 60_000)
})
