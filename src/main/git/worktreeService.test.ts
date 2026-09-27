import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { simpleGit } from 'simple-git'
import {
  DirtyWorktreeError,
  branchPoint,
  commitAll,
  createWorktree,
  dirtyFiles,
  removeWorktree,
  worktreeDirFor
} from './worktreeService'

let repoDir: string

async function makeTempRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'super-pi-wt-'))
  const git = simpleGit(dir)
  await git.init(['-b', 'main'])
  await git.addConfig('user.email', 'test@super-pi.local')
  await git.addConfig('user.name', 'super-pi test')
  await writeFile(join(dir, 'seed.txt'), 'seed\n')
  await git.add('-A')
  await git.commit('seed')
  return dir
}

beforeEach(async () => {
  repoDir = await makeTempRepo()
})

afterEach(async () => {
  // worktrees registered against repoDir keep it alive; prune first
  await simpleGit(repoDir).raw(['worktree', 'prune', '--force']).catch(() => {})
  await rm(repoDir, { recursive: true, force: true })
})

describe('worktreeDirFor', () => {
  it('flattens branch slashes into the worktree path', () => {
    expect(worktreeDirFor('D:/Repos/super-pi', 'task/42-add-dark-mode')).toBe(
      'D:/Repos/super-pi-worktrees/task-42-add-dark-mode'
    )
  })
})

describe('worktreeService against temp repos', () => {
  it('createWorktree creates the worktree and the branch', async () => {
    const wt = await createWorktree(repoDir, 'task/1-x')
    expect(wt).toBe(worktreeDirFor(repoDir, 'task/1-x'))

    const stdout = await simpleGit(repoDir).raw(['worktree', 'list'])
    expect(stdout).toContain(wt)
    const branches = await simpleGit(repoDir).branchLocal()
    expect(branches.all).toContain('task/1-x')
  })

  it('createWorktree reuses an existing branch instead of failing', async () => {
    await simpleGit(repoDir).raw(['branch', 'existing'])
    const wt = await createWorktree(repoDir, 'existing')
    expect(wt).toBe(worktreeDirFor(repoDir, 'existing'))
  })

  it('commitAll inside the worktree is visible from the main repo', async () => {
    const wt = await createWorktree(repoDir, 'task/1-x')
    await writeFile(join(wt, 'spec.md'), '# spec\n')
    const sha = await commitAll(wt, 'feat: write spec')

    const log = await simpleGit(repoDir).log({ from: 'main', to: 'task/1-x' })
    expect(log.latest?.hash).toBe(sha)
    expect(log.latest?.message).toContain('write spec')
  })

  it('branchPoint returns the seed SHA the branch diverged from', async () => {
    const wt = await createWorktree(repoDir, 'task/1-x')
    await writeFile(join(wt, 'spec.md'), '# spec\n')
    await commitAll(wt, 'feat: write spec')

    const seedSha = (await simpleGit(repoDir).log(['-1', '--format=%H', 'main'])).latest?.hash
    expect(await branchPoint(wt, 'main')).toBe(seedSha)
  })

  it('removeWorktree removes a clean worktree', async () => {
    const wt = await createWorktree(repoDir, 'task/1-x')
    await removeWorktree(wt)
    const stdout = await simpleGit(repoDir).raw(['worktree', 'list'])
    expect(stdout).not.toContain(wt)
  })

  it('removeWorktree refuses a dirty worktree and lists the files', async () => {
    const wt = await createWorktree(repoDir, 'task/1-x')
    await writeFile(join(wt, 'uncommitted.md'), 'wip\n')

    const err = await removeWorktree(wt).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DirtyWorktreeError)
    expect((err as DirtyWorktreeError).files).toContain('uncommitted.md')
    // worktree still registered
    const stdout = await simpleGit(repoDir).raw(['worktree', 'list'])
    expect(stdout).toContain(wt)
  })

  it('dirtyFiles reports modified files', async () => {
    const wt = await createWorktree(repoDir, 'task/1-x')
    expect(await dirtyFiles(wt)).toEqual([])
    await writeFile(join(wt, 'seed.txt'), 'changed\n')
    expect(await dirtyFiles(wt)).toContain('seed.txt')
  })
})
