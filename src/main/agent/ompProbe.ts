import { spawn } from 'node:child_process'

/**
 * Probe whether the OMP binary is usable. A machine without `omp` gets the
 * setup screen; task creation stays blocked until it resolves true.
 */

export function isOmpAvailable(
  ompBin?: string,
  ompArgs?: string[],
  timeoutMs = 5_000
): Promise<boolean> {
  const bin = ompBin ?? process.env['SUPER_PI_OMP_BIN'] ?? 'omp'
  const prefix = ompArgs ?? []
  return new Promise((resolve) => {
    let settled = false
    const done = (value: boolean): void => {
      if (settled) return
      settled = true
      resolve(value)
    }
    try {
      const child = spawn(bin, [...prefix, '--version'], { stdio: 'ignore' })
      const timer = setTimeout(() => {
        child.kill()
        done(false)
      }, timeoutMs)
      child.on('error', () => {
        clearTimeout(timer)
        done(false)
      })
      child.on('exit', (code) => {
        clearTimeout(timer)
        done(code === 0)
      })
    } catch {
      done(false)
    }
  })
}
