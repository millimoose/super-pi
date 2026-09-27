import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

/**
 * Typed channel-scoped bridge. The renderer never touches raw ipcRenderer —
 * every surface goes through these wrappers (see index.d.ts for the contract).
 */

const superPi = {
  git: {
    createWorktree: (repoPath: string, branch: string, baseRef?: string): Promise<string> =>
      ipcRenderer.invoke('super-pi:git/createWorktree', repoPath, branch, baseRef),
    removeWorktree: (worktreePath: string): Promise<void> =>
      ipcRenderer.invoke('super-pi:git/removeWorktree', worktreePath),
    commitAll: (worktreePath: string, message: string): Promise<string> =>
      ipcRenderer.invoke('super-pi:git/commitAll', worktreePath, message),
    push: (worktreePath: string): Promise<void> =>
      ipcRenderer.invoke('super-pi:git/push', worktreePath),
    branchPoint: (worktreePath: string, baseRef: string): Promise<string> =>
      ipcRenderer.invoke('super-pi:git/branchPoint', worktreePath, baseRef)
  },
  github: {
    hasToken: (): Promise<boolean> => ipcRenderer.invoke('super-pi:github/hasToken'),
    createDraftPR: (args: {
      owner: string
      repo: string
      head: string
      base: string
      title: string
      body: string
    }): Promise<number> => ipcRenderer.invoke('super-pi:github/createDraftPR', args),
    markPRReady: (args: { owner: string; repo: string; prNumber: number }): Promise<void> =>
      ipcRenderer.invoke('super-pi:github/markPRReady', args),
    mergePR: (args: { owner: string; repo: string; prNumber: number }): Promise<void> =>
      ipcRenderer.invoke('super-pi:github/mergePR', args),
    listPRFiles: (args: {
      owner: string
      repo: string
      prNumber: number
    }): Promise<Array<{ filename: string; patch?: string }>> =>
      ipcRenderer.invoke('super-pi:github/listPRFiles', args),
    createReview: (args: {
      owner: string
      repo: string
      prNumber: number
      verdict: 'approved' | 'changes_requested'
      summary: string
      comments: Array<{ path: string; line: number; body: string }>
    }): Promise<void> => ipcRenderer.invoke('super-pi:github/createReview', args)
  },
  tracker: {
    listOpenIssues: (
      repoPath: string
    ): Promise<Array<{ id: string; title: string; url: string; body: string }>> =>
      ipcRenderer.invoke('super-pi:tracker/listOpenIssues', repoPath),
    getIssue: (
      repoPath: string,
      id: string
    ): Promise<{ id: string; title: string; url: string; body: string }> =>
      ipcRenderer.invoke('super-pi:tracker/getIssue', repoPath, id),
    createIssue: (
      repoPath: string,
      input: { title: string; body: string }
    ): Promise<{ id: string; title: string; url: string; body: string }> =>
      ipcRenderer.invoke('super-pi:tracker/createIssue', repoPath, input)
  },
  agent: {
    startStage: (args: {
      taskId: string
      worktreePath: string
      prompt: string
    }): Promise<Record<string, unknown>> => ipcRenderer.invoke('super-pi:agent/startStage', args),
    steer: (taskId: string, text: string): Promise<void> =>
      ipcRenderer.invoke('super-pi:agent/steer', taskId, text),
    stop: (taskId: string): Promise<void> => ipcRenderer.invoke('super-pi:agent/stop', taskId),
    generateTitleSlug: (
      prompt: string,
      repoPath: string
    ): Promise<{ title: string; slug: string }> =>
      ipcRenderer.invoke('super-pi:agent/generateTitleSlug', prompt, repoPath)
  },
  agentEvents: {
    /** Subscribe to validated RPC frames for one task. Returns unsubscribe. */
    subscribe: (taskId: string, cb: (frame: Record<string, unknown>) => void): (() => void) => {
      const listener = (
        _e: Electron.IpcRendererEvent,
        id: string,
        frame: Record<string, unknown>
      ): void => {
        if (id === taskId) cb(frame)
      }
      ipcRenderer.on('super-pi:agent-event', listener)
      return () => ipcRenderer.off('super-pi:agent-event', listener)
    }
  },
  prompts: {
    loadReviewerTemplate: (name: string): Promise<string> =>
      ipcRenderer.invoke('super-pi:prompts/loadReviewerTemplate', name),
    readTextFile: (path: string): Promise<string> =>
      ipcRenderer.invoke('super-pi:prompts/readTextFile', path)
  },
  dialog: {
    pickRepo: (): Promise<string | null> => ipcRenderer.invoke('super-pi:dialog/pickRepo')
  }
}

export type SuperPiBridge = typeof superPi

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('superPi', superPi)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.superPi = superPi
}
