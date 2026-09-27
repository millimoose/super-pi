import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { isOmpAvailable } from './ompProbe'

const FAKE_OMP = join(process.cwd(), 'resources', 'test', 'fake-omp.mjs')

describe('isOmpAvailable', () => {
  it('resolves true when the binary answers --version', async () => {
    expect(
      await isOmpAvailable(process.execPath, [FAKE_OMP])
    ).toBe(true)
  }, 15_000)

  it('resolves false for a nonexistent binary', async () => {
    expect(
      await isOmpAvailable('definitely-not-a-real-binary-xyz')
    ).toBe(false)
  }, 15_000)

  it('resolves false when the binary exits non-zero', async () => {
    // node intercepts --version before -e; cmd exits with our code untouched
    const fail = await isOmpAvailable('cmd', ['/c', 'exit', '2'])
    expect(fail).toBe(false)
  }, 15_000)
})
