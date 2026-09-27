#!/usr/bin/env node
/**
 * Fake `omp` for tests. Modes via SUPER_PI_FAKE_MODE:
 *  - rpc:        full RPC protocol speaker (default when --mode rpc is present)
 *  - rpc-marker: RPC speaker that never calls host tools; writes marker file
 *  - rpc-exit:   RPC speaker that exits after the prompt command
 *  - print-ok:   -p mode printing a valid {"title","slug"} JSON
 *  - print-bad:  -p mode printing prose only (fallback path)
 *  - print-fail: -p mode exiting non-zero with "unknown model" (role retry path)
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import readline from 'node:readline'

const mode = process.env['SUPER_PI_FAKE_MODE'] ?? 'rpc'
const args = process.argv.slice(2)

if (args.includes('-p')) {
  if (mode === 'print-ok') {
    process.stdout.write('Here you go: {"title":"Dark mode toggle","slug":"dark-mode-toggle"}\n')
    process.exit(0)
  }
  if (mode === 'print-bad') {
    process.stdout.write('I suggest calling it the night theme feature.\n')
    process.exit(0)
  }
  if (mode === 'print-fail') {
    process.stderr.write('error: unknown model role @smol\n')
    process.exit(1)
  }
  process.stdout.write('{"title":"Fallback title","slug":"fallback-title"}\n')
  process.exit(0)
}

// ---- RPC mode ----
const rl = readline.createInterface({ input: process.stdin })
const send = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`)

send({ type: 'ready', protocolVersion: 1, supportedProtocolVersions: [1], maxFrameBytes: 1048576 })

let reqN = 0
const promptCmds = []

rl.on('line', (line) => {
  let cmd
  try {
    cmd = JSON.parse(line)
  } catch {
    send({ type: 'response', command: 'parse', success: false, error: 'bad json' })
    return
  }
  reqN++
  switch (cmd.type) {
    case 'set_event_filter':
    case 'set_host_tools':
      send({
        id: cmd.id,
        type: 'response',
        command: cmd.type,
        success: true,
        data: { toolNames: [] }
      })
      break
    case 'prompt':
      promptCmds.push(cmd)
      send({
        id: cmd.id,
        type: 'response',
        command: 'prompt',
        success: true,
        data: { agentInvoked: true }
      })
      void runPrompt(cmd)
      break
    case 'steer':
      send({ id: cmd.id, type: 'response', command: 'steer', success: true })
      break
    case 'abort':
      send({ id: cmd.id, type: 'response', command: 'abort', success: true })
      break
    default:
      send({
        type: 'response',
        command: cmd.type,
        success: false,
        error: `fake-omp: unsupported ${cmd.type}`
      })
  }
})

async function runPrompt(cmd) {
  const cwd = process.env['SUPER_PI_FAKE_CWD'] ?? process.cwd()
  if (mode === 'rpc-exit') {
    process.exit(3)
  }
  send({ type: 'agent_start' })
  send({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', delta: 'working on it' },
    message: { role: 'assistant', content: [] }
  })

  // write a canned artifact + commit-style marker
  await mkdir(join(cwd, 'docs', 'superpowers'), { recursive: true })
  await writeFile(join(cwd, 'docs', 'superpowers', 'spec.md'), '# Canned spec\n')
  await mkdir(join(cwd, '.super-pi'), { recursive: true })

  if (mode === 'rpc-marker') {
    await writeFile(
      join(cwd, '.super-pi', 'stage-result.json'),
      JSON.stringify({
        stage: 'brainstorming',
        status: 'complete',
        artifactPath: 'docs/superpowers/spec.md'
      })
    )
  } else {
    // host tool call path
    const callId = `host_${reqN}`
    send({
      type: 'host_tool_call',
      id: callId,
      toolCallId: `toolu_${reqN}`,
      toolName: 'super_pi_stage_result',
      arguments: {
        stage: 'brainstorming',
        status: 'complete',
        artifactPath: 'docs/superpowers/spec.md'
      }
    })
    // wait for the host's result frame before settling
    await new Promise((resolve) => {
      const onLine = (line) => {
        let frame
        try {
          frame = JSON.parse(line)
        } catch {
          return
        }
        if (frame.type === 'host_tool_result' && frame.id === callId) {
          rl.off('line', onLine)
          resolve()
        }
      }
      rl.on('line', onLine)
    })
  }

  send({ type: 'agent_end', messages: [], isTerminal: true })
}
