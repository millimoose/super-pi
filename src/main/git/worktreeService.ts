import { basename, dirname, join } from 'node:path'
import { simpleGit, type SimpleGit } from 'simple-git'
import type { StatusResult } from 'simple-git'

export class DirtyWorktreeError extends Error {
  constructor(
    public readonly worktreePath: string,
    public readonly files: string[]
  ) {
    super(`worktree "${worktreePath}" has uncommitted changes: ${files.join(', ')}`)
    this.name = 'DirtyWorktreeError'
  }
}

export function worktreeDirFor(repoPath: string, branch: string): string {
  const repoName = basename(repoPath)
  // branch names contain "/" (task/<id>-<slug>); flatten for a single directory.
  // git prints forward slashes on every platform — normalize to match.
  const safeBranch = branch.replaceAll('/', '-')
  return join(dirname(repoPath), `${repoName}-worktrees`, safeBranch).replaceAll('\\', '/')
}

export function gitAt(cwd: string): SimpleGit {
  return simpleGit({ baseDir: cwd })
}

export async function createWorktree(
  repoPath: string,
  branch: string,
  baseRef = 'HEAD'
): Promise<string> {
  const git = gitAt(repoPath)
  const wtPath = worktreeDirFor(repoPath, branch)
  const branches = await git.branchLocal()
  if (branches.all.includes(branch)) {
    await git.raw(['worktree', 'add', wtPath, branch])
  } else {
    await git.raw(['worktree', 'add', '-b', branch, wtPath, baseRef])
  }
  return wtPath
}

export async function commitAll(worktreePath: string, message: string): Promise<string> {
  const git = gitAt(worktreePath)
  await git.add('-A')
  const commit = await git.commit(message)
  return commit.commit
}

export async function push(worktreePath: string): Promise<void> {
  const git = gitAt(worktreePath)
  const branch = (await git.branchLocal()).current
  await git.push(['-u', 'origin', branch])
}

/** SHA where the worktree's branch diverged from baseRef (reviewer BASE_SHA). */
export async function branchPoint(worktreePath: string, baseRef: string): Promise<string> {
  const sha = await gitAt(worktreePath).raw(['merge-base', 'HEAD', baseRef])
  return sha.trim()
}

export async function dirtyFiles(worktreePath: string): Promise<string[]> {
  const status: StatusResult = await gitAt(worktreePath).status()
  return [...status.modified, ...status.not_added, ...status.deleted, ...status.created]
}

export async function removeWorktree(worktreePath: string): Promise<void> {
  const files = await dirtyFiles(worktreePath)
  if (files.length > 0) throw new DirtyWorktreeError(worktreePath, files)
  // run from the common git dir: deleting cwd fails on Windows
  const commonDir = (await gitAt(worktreePath).revparse('--git-common-dir')).trim()
  const mainGit = gitAt(dirname(commonDir))
  await mainGit.raw(['worktree', 'remove', worktreePath])
}
