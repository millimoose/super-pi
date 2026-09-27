import { simpleGit } from 'simple-git'
import type { Octokit } from 'octokit'
import { createGithubTracker } from './githubTracker'
import type { GithubIssuesApi } from './githubTracker'
import { UnsupportedTrackerError } from './tracker'
import type { IssueTracker } from './tracker'

/**
 * Parse an `owner/repo` pair from a git remote URL. Supports the common
 * github.com forms; returns null for anything else (unsupported tracker).
 */
export function parseGithubRemote(url: string): { owner: string; repo: string } | null {
  const cleaned = url.trim().replace(/\.git$/i, '')
  // https://github.com/owner/repo or http variant
  const https = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/i.exec(cleaned)
  if (https) return { owner: https[1], repo: https[2] }
  // git@github.com:owner/repo
  const ssh = /^git@github\.com:([^/]+)\/([^/]+)$/i.exec(cleaned)
  if (ssh) return { owner: ssh[1], repo: ssh[2] }
  // ssh://git@github.com/owner/repo
  const sshUrl = /^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+)$/i.exec(cleaned)
  if (sshUrl) return { owner: sshUrl[1], repo: sshUrl[2] }
  return null
}

/** Resolve the origin remote URL of a repo, or null when none is set. */
export async function originUrl(repoPath: string): Promise<string | null> {
  const remotes = await simpleGit(repoPath).getRemotes(true)
  const origin = remotes.find((r) => r.name === 'origin')
  return origin?.refs.fetch ?? null
}

export async function createTrackerForRepo(
  repoPath: string,
  deps: { octokit: Octokit }
): Promise<IssueTracker> {
  const url = await originUrl(repoPath)
  if (!url) {
    throw new UnsupportedTrackerError('(no origin remote configured)')
  }
  const parsed = parseGithubRemote(url)
  if (!parsed) throw new UnsupportedTrackerError(url)
  const api = deps.octokit as unknown as GithubIssuesApi
  return createGithubTracker(api, parsed.owner, parsed.repo)
}
