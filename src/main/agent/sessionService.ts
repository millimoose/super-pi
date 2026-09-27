import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { RpcClient, type RpcFrame } from './rpcClient'
import type { HostToolDefinition } from './rpcClient'
import { StageResult, ReviewResult } from '@shared/agent/resultSchemas'

/**
 * One RPC child per stage run. Streams validated frames to the caller; when
 * the run settles (agent_end isTerminal !== false), resolves with the
 * structured stage/review result received via host tool — or the marker-file
 * fallback — or fails if neither channel produced a result.
 */

export const EVENT_FILTER = [
  'agent_start',
  'agent_end',
  'message_start',
  'message_update',
  'message_end',
  'tool_execution_start',
  'tool_execution_end',
  'notice'
]

const HOST_TOOLS: HostToolDefinition[] = [
  {
    name: 'super_pi_stage_result',
    label: 'Stage Result',
    description: 'Report the outcome of the current superpowers stage',
    parameters: {
      type: 'object',
      properties: {
        stage: { type: 'string' },
        status: { type: 'string' },
        artifactPath: { type: 'string' },
        notes: { type: 'string' }
      },
      required: ['stage', 'status'],
      additionalProperties: false
    }
  },
  {
    name: 'super_pi_review_result',
    label: 'Review Result',
    description: 'Report a review verdict with quoted-span comments',
    parameters: {
      type: 'object',
      properties: {
        verdict: { type: 'string' },
        summary: { type: 'string' },
        comments: { type: 'string' }
      },
      required: ['verdict', 'summary'],
      additionalProperties: false
    }
  }
]

export type StageOutcome =
  | { kind: 'stage'; result: StageResult }
  | { kind: 'review'; result: ReviewResult }
  | { kind: 'failure'; error: string; transcript: string[] }

export type SessionCallbacks = {
  onFrame?: (frame: RpcFrame) => void
}

export class SessionService extends EventEmitter {
  private sessions = new Map<string, RpcClient>()

  constructor(
    private readonly options: {
      ompBin?: string
      ompArgs?: string[]
      env?: Record<string, string>
      appDataDir: string
    }
  ) {
    super()
  }

  async startStage(
    taskId: string,
    input: {
      worktreePath: string
      prompt: string
    },
    callbacks: SessionCallbacks = {}
  ): Promise<StageOutcome> {
    if (this.sessions.has(taskId)) {
      throw new Error(`session for task ${taskId} already running`)
    }
    const client = new RpcClient({
      cwd: input.worktreePath,
      sessionDir: join(this.options.appDataDir, 'agent-sessions', taskId),
      ompBin: this.options.ompBin,
      ompArgs: this.options.ompArgs,
      env: this.options.env
    })
    this.sessions.set(taskId, client)

    const transcript: string[] = []
    const toolResults: Array<{ kind: 'stage' | 'review'; result: unknown }> = []

    client.on('frame', (frame: RpcFrame) => {
      transcript.push(JSON.stringify(frame))
      callbacks.onFrame?.(frame)
      this.emit('agent-event', { taskId, frame })
    })
    client.on('stderr', (text: string) => transcript.push(`[stderr] ${text}`))

    client.on('host_tool_call', (frame: RpcFrame) => {
      const name = frame.toolName as string
      const args = frame.arguments as Record<string, unknown>
      if (name === 'super_pi_stage_result') {
        const parsed = StageResult(args)
        if (!(parsed instanceof type.errors)) {
          toolResults.push({ kind: 'stage', result: parsed })
          client.respondHostTool(frame.id as string, 'stage result recorded')
        } else {
          client.respondHostTool(frame.id as string, `invalid stage result: ${parsed}`, true)
        }
      } else if (name === 'super_pi_review_result') {
        // comments arrive JSON-encoded in the string parameter (schema is
        // string-typed for the wire); parse + validate here
        let comments: unknown = []
        try {
          comments = JSON.parse(String(args.comments ?? '[]'))
        } catch {
          // leave as [] — validation below reports the failure
        }
        const parsed = ReviewResult({ ...args, comments })
        if (!(parsed instanceof type.errors)) {
          toolResults.push({ kind: 'review', result: parsed })
          client.respondHostTool(frame.id as string, 'review result recorded')
        } else {
          client.respondHostTool(frame.id as string, `invalid review result: ${parsed}`, true)
        }
      } else {
        client.respondHostTool(frame.id as string, `unknown host tool ${name}`, true)
      }
    })

    try {
      await client.configure(EVENT_FILTER, HOST_TOOLS)
      await client.prompt(input.prompt)

      await new Promise<void>((resolve, reject) => {
        const onAgentEnd = (frame: RpcFrame): void => {
          if (frame.isTerminal !== false) {
            cleanup()
            resolve()
          }
        }
        const onExit = (): void => {
          cleanup()
          reject(new Error('omp rpc exited before settling'))
        }
        const cleanup = (): void => {
          client.off('agent_end', onAgentEnd)
          client.off('exit', onExit)
        }
        client.on('agent_end', onAgentEnd)
        client.on('exit', onExit)
      })
    } catch (e) {
      this.sessions.delete(taskId)
      client.kill()
      return {
        kind: 'failure',
        error: e instanceof Error ? e.message : String(e),
        transcript: transcript.slice(-50)
      }
    }

    this.sessions.delete(taskId)
    client.kill()

    // host tool result, else marker-file fallback
    const fromTool = toolResults.at(-1)
    if (fromTool) {
      return fromTool.kind === 'stage'
        ? { kind: 'stage', result: fromTool.result as StageResult }
        : { kind: 'review', result: fromTool.result as ReviewResult }
    }

    const marker = await this.readMarker(input.worktreePath)
    if (marker) return marker

    return {
      kind: 'failure',
      error: 'agent finished without a result (no host tool call, no marker file)',
      transcript: transcript.slice(-50)
    }
  }

  private async readMarker(worktreePath: string): Promise<StageOutcome | null> {
    for (const [file, kind] of [
      ['.super-pi/stage-result.json', 'stage'],
      ['.super-pi/review-result.json', 'review']
    ] as const) {
      try {
        const raw = await readFile(join(worktreePath, file), 'utf8')
        const parsed =
          kind === 'stage' ? StageResult(JSON.parse(raw)) : ReviewResult(JSON.parse(raw))
        if (!(parsed instanceof type.errors)) {
          return kind === 'stage'
            ? { kind: 'stage', result: parsed as StageResult }
            : { kind: 'review', result: parsed as ReviewResult }
        }
      } catch {
        // no marker / invalid — try the next channel
      }
    }
    return null
  }

  async steer(taskId: string, text: string): Promise<void> {
    const client = this.sessions.get(taskId)
    if (!client) throw new Error(`no running session for task ${taskId}`)
    await client.steer(text)
  }

  async stopSession(taskId: string): Promise<void> {
    const client = this.sessions.get(taskId)
    if (!client) throw new Error(`no running session for task ${taskId}`)
    await client.abort()
    client.kill()
    this.sessions.delete(taskId)
  }
}

import { type } from 'arktype'
