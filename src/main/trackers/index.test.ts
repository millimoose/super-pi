import { describe, expect, it } from 'vitest'
import { parseGithubRemote } from './index'
import { mapAnchorToPosition } from '../github/diffPosition'

describe('parseGithubRemote', () => {
  it.each([
    ['https://github.com/octo/hello.git', { owner: 'octo', repo: 'hello' }],
    ['https://github.com/octo/hello', { owner: 'octo', repo: 'hello' }],
    ['http://github.com/octo/hello.git', { owner: 'octo', repo: 'hello' }],
    ['git@github.com:octo/hello.git', { owner: 'octo', repo: 'hello' }],
    ['ssh://git@github.com/octo/hello.git', { owner: 'octo', repo: 'hello' }]
  ])('parses %s', (url, expected) => {
    expect(parseGithubRemote(url)).toEqual(expected)
  })

  it('rejects non-github and malformed remotes', () => {
    expect(parseGithubRemote('https://gitlab.com/octo/hello.git')).toBeNull()
    expect(parseGithubRemote('git@gitlab.com:octo/hello.git')).toBeNull()
    expect(parseGithubRemote('https://github.com/octo')).toBeNull()
    expect(parseGithubRemote('')).toBeNull()
  })
})

// ---- tracker (structure exercised through a stub GithubIssuesApi) ----
import { createGithubTracker } from './githubTracker'
import type { GithubIssuesApi } from './githubTracker'

function stubApi(
  issue: Partial<{
    list: Array<{
      number: number
      title: string
      html_url: string
      body: string | null
      pull_request?: object
    }>
    single: { number: number; title: string; html_url: string; body: string | null }
    created: { number: number; title: string; html_url: string; body: string | null }
  }>
): { api: GithubIssuesApi; calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    api: {
      rest: {
        issues: {
          async listForRepo() {
            calls.push('listForRepo')
            return { data: issue.list ?? [] }
          },
          async get() {
            calls.push('get')
            return { data: issue.single ?? { number: 0, title: '', html_url: '', body: '' } }
          },
          async create(params) {
            calls.push(`create:${params.title}`)
            return {
              data: issue.created ?? {
                number: 0,
                title: params.title,
                html_url: '',
                body: params.body
              }
            }
          }
        }
      }
    }
  }
}

describe('githubTracker', () => {
  it('listOpen filters out pull requests and maps fields', async () => {
    const { api } = stubApi({
      list: [
        {
          number: 1,
          title: 'Real issue',
          html_url: 'https://github.com/o/r/issues/1',
          body: 'body'
        },
        {
          number: 2,
          title: 'A PR',
          html_url: 'https://github.com/o/r/pull/2',
          body: null,
          pull_request: {}
        }
      ]
    })
    const tracker = createGithubTracker(api, 'octo', 'hello')
    const issues = await tracker.listOpen()
    expect(issues).toEqual([
      { id: '1', title: 'Real issue', url: 'https://github.com/o/r/issues/1', body: 'body' }
    ])
  })

  it('get maps by numeric id and create round-trips', async () => {
    const { api, calls } = stubApi({
      single: { number: 7, title: 'Broken build', html_url: 'u7', body: 'it breaks' },
      created: { number: 9, title: 'New thing', html_url: 'u9', body: 'do it' }
    })
    const tracker = createGithubTracker(api, 'octo', 'hello')
    expect(await tracker.get('7')).toEqual({
      id: '7',
      title: 'Broken build',
      url: 'u7',
      body: 'it breaks'
    })
    const created = await tracker.create({ title: 'New thing', body: 'do it' })
    expect(created).toEqual({ id: '9', title: 'New thing', url: 'u9', body: 'do it' })
    expect(calls).toContain('create:New thing')
  })
})

// ---- diffPosition ----
const CONTENT = ['line one', 'added by agent', 'kept context line', 'tail'].join('\n')

const PATCH = [
  'diff --git a/file.md b/file.md',
  '--- a/file.md',
  '+++ b/file.md',
  '@@ -1,2 +1,3 @@',
  ' line one',
  '+added by agent',
  ' kept context line',
  '@@ -4,1 +5,1 @@',
  '-tail old',
  '+tail'
].join('\n')

describe('mapAnchorToPosition', () => {
  it('maps a unique added line to its RIGHT position', () => {
    const result = mapAnchorToPosition(PATCH, CONTENT, {
      exact: 'added by agent',
      prefix: 'line one\n',
      suffix: '\nkept'
    })
    // position: @@ = 1, ' line one' = 2, '+added by agent' = 3
    expect(result).toEqual({ line: 2, side: 'RIGHT', position: 3 })
  })

  it('maps a context line as commentable on the RIGHT side', () => {
    const result = mapAnchorToPosition(PATCH, CONTENT, {
      exact: 'kept context line',
      prefix: 'added by agent\n',
      suffix: '\ntail'
    })
    expect(result).toEqual({ line: 3, side: 'RIGHT', position: 4 })
  })

  it('returns null for text present in the file but outside the diff', () => {
    // 'tail' sits at line 4; the patch's RIGHT side never reaches line 4
    expect(
      mapAnchorToPosition(PATCH, CONTENT, {
        exact: 'tail',
        prefix: 'kept context line\n',
        suffix: ''
      })
    ).toBeNull()
  })

  it('disambiguates duplicate quotes with prefix/suffix', () => {
    const dupContent = ['x reuse this y', 'x reuse this z'].join('\n')
    const dupPatch = [
      'diff --git a/dup.md b/dup.md',
      '--- a/dup.md',
      '+++ b/dup.md',
      '@@ -1,2 +1,2 @@',
      ' x reuse this y',
      '-x reuse that z',
      '+x reuse this z'
    ].join('\n')
    // exact alone is ambiguous (2 hits); suffix pins the second
    const result = mapAnchorToPosition(dupPatch, dupContent, {
      exact: 'reuse this',
      prefix: 'x ',
      suffix: ' z'
    })
    // '-' lines still count toward GitHub's position index: @@=1, ctx=2, -=3, +=4
    expect(result).toEqual({ line: 2, side: 'RIGHT', position: 4 })
  })

  it('returns null when the quote is still ambiguous', () => {
    const dupContent = ['reuse this a', 'reuse this b'].join('\n')
    expect(
      mapAnchorToPosition(PATCH, dupContent, { exact: 'reuse this', prefix: '', suffix: '' })
    ).toBeNull()
  })

  it('returns null when the quote is gone', () => {
    expect(
      mapAnchorToPosition(PATCH, CONTENT, { exact: 'no such text', prefix: '', suffix: '' })
    ).toBeNull()
  })
})
