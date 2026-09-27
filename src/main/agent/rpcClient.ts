import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { createInterface } from 'node:readline'

/**
 * JSONL RPC client for `omp --mode rpc` (protocol v1; frames stay < 1 MiB).
 * Wire contract: omp://rpc.md.
 *
 * - stdout frames: ready / response (id-correlated) / agent events /
 *   host_tool_call.
 * - Run completion: an `agent_end` frame with `isTerminal !== false`.
 */

export type RpcFrame = Record<string, unknown> & { type: string }

export type HostToolDefinition = {
  name: string
  label: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, { type: string }>
    required: string[]
    additionalProperties: false
  }
}

export type RpcClientOptions = {
  cwd: string
  sessionDir: string
  ompBin?: string
  /** prepended before the standard omp args (test fake: [scriptPath]) */
  ompArgs?: string[]
  /** extra child env (merged over process.env) */
  env?: Record<string, string>
}

export class RpcClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams
  private pending = new Map<string, { resolve: (f: RpcFrame) => void; reject: (e: Error) => void }>()
  private nextId = 1
  private readline: ReturnType<typeof createInterface>
  public ready: Promise<RpcFrame>

  constructor(options: RpcClientOptions) {
    super()
    const bin = options.ompBin ?? process.env['SUPER_PI_OMP_BIN'] ?? 'omp'
    this.child = spawn(
      bin,
      [
        ...(options.ompArgs ?? process.env['SUPER_PI_OMP_ARGS']?.split('\u0000') ?? []),
        '--mode', 'rpc',
        '--no-ui',
        '--cwd', options.cwd,
        '--session-dir', options.sessionDir,
        '--approval-mode', 'yolo'
      ],
      { cwd: options.cwd, env: { ...process.env, ...options.env } }
    )
    this.child.on('exit', (code, signal) => {
      this.emit('exit', { code, signal })
      for (const p of this.pending.values()) p.reject(new Error(`omp rpc exited (code=${code}, signal=${signal})`))
      this.pending.clear()
    })
    this.child.stderr.on('data', (d: Buffer) => this.emit('stderr', d.toString()))

    this.readline = createInterface({ input: this.child.stdout })
    this.readline.on('line', (line) => this.handleLine(line))

    this.ready = new Promise<RpcFrame>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('omp rpc: no ready frame')), 15_000)
      const onReady = (frame: RpcFrame) => {
        clearTimeout(timer)
        this.off('exit', onExit)
        resolve(frame)
      }
      const onExit = () => {
        clearTimeout(timer)
        reject(new Error('omp rpc exited before ready'))
      }
      this.once('ready_frame', onReady)
      this.once('exit', onExit)
    })
  }

  private handleLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    let frame: RpcFrame
    try {
      frame = JSON.parse(trimmed) as RpcFrame
    } catch {
      this.emit('bad_frame', trimmed)
      return
    }
    switch (frame.type) {
      case 'ready':
        this.emit('ready_frame', frame)
        break
      case 'response': {
        const id = typeof frame.id === 'string' ? frame.id : undefined
        if (id && this.pending.has(id)) {
          const p = this.pending.get(id) as { resolve: (f: RpcFrame) => void }
          this.pending.delete(id)
          p.resolve(frame)
        } else {
          this.emit('unmatched_response', frame)
        }
        break
      }
      default:
        this.emit('frame', frame)
        if (frame.type === 'agent_end') this.emit('agent_end', frame)
        if (frame.type === 'host_tool_call') this.emit('host_tool_call', frame)
        break
    }
  }

  private send(command: Record<string, unknown>): Promise<RpcFrame> {
    const id = `req_${this.nextId++}`
    const withId = { id, ...command }
    return new Promise<RpcFrame>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.child.stdin.write(`${JSON.stringify(withId)}\n`)
    })
  }

  /** Await readiness, then configure event filter + host tools. */
  async configure(eventFilter: string[], tools: HostToolDefinition[]): Promise<void> {
    await this.ready
    await this.send({ type: 'set_event_filter', events: eventFilter })
    await this.send({ type: 'set_host_tools', tools })
  }

  async prompt(message: string): Promise<RpcFrame> {
    return this.send({ type: 'prompt', message })
  }

  async steer(message: string): Promise<RpcFrame> {
    return this.send({ type: 'steer', message })
  }

  async abort(): Promise<RpcFrame> {
    return this.send({ type: 'abort' })
  }

  respondHostTool(callId: string, text: string, isError = false): void {
    const result = { content: [{ type: 'text', text }] }
    const frame = isError
      ? { type: 'host_tool_result', id: callId, isError: true, result }
      : { type: 'host_tool_result', id: callId, result }
    this.child.stdin.write(`${JSON.stringify(frame)}\n`)
  }

  kill(): void {
    this.child.kill()
  }
}
