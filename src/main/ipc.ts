import { ipcMain, dialog, BrowserWindow } from 'electron'
import { Octokit } from 'octokit'
import { resolveToken } from './github/auth'
import { createGithubService } from './github/githubService'
import { createTrackerForRepo } from './trackers'
import type { IssueTracker } from './trackers/tracker'
import {
  createWorktree,
  removeWorktree,
  commitAll,
  push,
  branchPoint
} from './git/worktreeService'
import { SessionService } from './agent/sessionService'
import { generateTitleSlug } from './agent/titleSlugService'
import { loadReviewerTemplate } from './prompts/templates'

/**
 * Typed, channel-scoped IPC surface. Main stays stateless except the
 * per-appData session service. Handlers never trust renderer paths beyond
 * the arguments documented in preload/index.d.ts.
 */

export type MainServices = {
  sessionService: SessionService
  appDataDir: string
}

const trackers = new Map<string, IssueTracker>()

async function trackerFor(repoPath: string): Promise<IssueTracker> {
  const cached = trackers.get(repoPath)
  if (cached) return cached
  const token = await resolveToken()
  if (!token) throw new Error('no GitHub token — run `gh auth login` or set GITHUB_TOKEN')
  const tracker = await createTrackerForRepo(repoPath, {
    octokit: new Octokit({ auth: token.token })
  })
  trackers.set(repoPath, tracker)
  return tracker
}

async function github(): Promise<ReturnType<typeof createGithubService>> {
  const token = await resolveToken()
  if (!token) throw new Error('no GitHub token — run `gh auth login` or set GITHUB_TOKEN')
  return createGithubService(new Octokit({ auth: token.token }))
}

type Json = Record<string, unknown>

export function registerIpc(services: MainServices): void {
  // --- git ---
  ipcMain.handle('super-pi:git/createWorktree', (_e, repoPath: string, branch: string, baseRef?: string) =>
    createWorktree(repoPath, branch, baseRef ?? 'HEAD')
  )
  ipcMain.handle('super-pi:git/removeWorktree', (_e, worktreePath: string) => removeWorktree(worktreePath))
  ipcMain.handle('super-pi:git/commitAll', (_e, worktreePath: string, message: string) =>
    commitAll(worktreePath, message)
  )
  ipcMain.handle('super-pi:git/push', (_e, worktreePath: string) => push(worktreePath))
  ipcMain.handle('super-pi:git/branchPoint', (_e, worktreePath: string, baseRef: string) =>
    branchPoint(worktreePath, baseRef)
  )

  // --- github ---
  ipcMain.handle('super-pi:github/hasToken', () => resolveToken().then((t) => t !== undefined))
  ipcMain.handle(
    'super-pi:github/createDraftPR',
    (_e, args: { owner: string; repo: string; head: string; base: string; title: string; body: string }) =>
      github().then((g) => g.createDraftPR(args))
  )
  ipcMain.handle(
    'super-pi:github/markPRReady',
    (_e, args: { owner: string; repo: string; prNumber: number }) =>
      github().then((g) => g.markPRReady(args))
  )
  ipcMain.handle('super-pi:github/mergePR', (_e, args: { owner: string; repo: string; prNumber: number }) =>
    github().then((g) => g.mergePR(args))
  )
  ipcMain.handle(
    'super-pi:github/listPRFiles',
    (_e, args: { owner: string; repo: string; prNumber: number }) =>
      github().then((g) => g.listPRFiles(args))
  )
  ipcMain.handle(
    'super-pi:github/createReview',
    (
      _e,
      args: {
        owner: string
        repo: string
        prNumber: number
        verdict: 'approved' | 'changes_requested'
        summary: string
        comments: Array<{ path: string; line: number; body: string }>
      }
    ) => github().then((g) => g.createReview(args))
  )

  // --- tracker ---
  ipcMain.handle('super-pi:tracker/listOpenIssues', (_e, repoPath: string) =>
    trackerFor(repoPath).then((t) => t.listOpen())
  )
  ipcMain.handle('super-pi:tracker/getIssue', (_e, repoPath: string, id: string) =>
    trackerFor(repoPath).then((t) => t.get(id))
  )
  ipcMain.handle(
    'super-pi:tracker/createIssue',
    (_e, repoPath: string, input: { title: string; body: string }) =>
      trackerFor(repoPath).then((t) => t.create(input))
  )

  // --- agent ---
  ipcMain.handle(
    'super-pi:agent/startStage',
    async (
      e,
      args: { taskId: string; worktreePath: string; prompt: string }
    ): Promise<Json> => {
      const outcome = await services.sessionService.startStage(
        args.taskId,
        { worktreePath: args.worktreePath, prompt: args.prompt },
        {
          onFrame: (frame) => {
            if (!e.sender.isDestroyed()) e.sender.send('super-pi:agent-event', args.taskId, frame)
          }
        }
      )
      return outcome as unknown as Json
    }
  )
  ipcMain.handle('super-pi:agent/steer', (_e, taskId: string, text: string) =>
    services.sessionService.steer(taskId, text)
  )
  ipcMain.handle('super-pi:agent/stop', (_e, taskId: string) =>
    services.sessionService.stopSession(taskId)
  )
  ipcMain.handle(
    'super-pi:agent/generateTitleSlug',
    (_e, prompt: string, repoPath: string) => generateTitleSlug(prompt, { cwd: repoPath })
  )

  // --- prompts (reviewer templates) ---
  ipcMain.handle('super-pi:prompts/loadReviewerTemplate', (_e, name: string) =>
    loadReviewerTemplate(name as Parameters<typeof loadReviewerTemplate>[0])
  )

  // --- dialog ---
  ipcMain.handle('super-pi:dialog/pickRepo', async () => {
    const win = BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
}
