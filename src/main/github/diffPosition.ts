import type { AnchorData as Anchor } from '@shared/store/schema'

/**
 * Map a text-quote anchor to a GitHub review-comment position within one
 * file's unified patch. Returns null when the anchor cannot be located in the
 * current content or does not fall on a RIGHT-side commentable diff line —
 * callers fold unmappable anchors into the review body as quoted spans.
 *
 * GitHub position semantics: 1-based index of the line within the diff
 * (file header excluded, each hunk's @@ header counted).
 */

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/

function occurrences(content: string, needle: string): number[] {
  const result: number[] = []
  let idx = content.indexOf(needle)
  while (idx !== -1) {
    result.push(idx)
    idx = content.indexOf(needle, idx + 1)
  }
  return result
}

function lineContentAt(content: string, line: number): string {
  return content.split('\n')[line - 1] ?? ''
}

export function mapAnchorToPosition(
  patch: string,
  fileContent: string,
  anchor: Anchor
): { line: number; side: 'RIGHT'; position: number } | null {
  const { exact, prefix, suffix } = anchor
  if (!exact) return null

  let candidates = occurrences(fileContent, exact)
  if (candidates.length === 0) return null
  if (candidates.length > 1 && (prefix || suffix)) {
    candidates = candidates.filter((idx) => {
      const before = fileContent.slice(Math.max(0, idx - prefix.length), idx)
      const after = fileContent.slice(idx + exact.length, idx + exact.length + suffix.length)
      return (!prefix || before === prefix) && (!suffix || after === suffix)
    })
  }
  if (candidates.length !== 1) return null // ambiguous or gone

  const targetLine = fileContent.slice(0, candidates[0]).split('\n').length

  const patchLines = patch.split('\n')
  let position = 0
  let inHunk = false
  let newLine = 0
  for (const raw of patchLines) {
    const header = HUNK_HEADER.exec(raw)
    if (header) {
      position++
      inHunk = true
      newLine = Number(header[1])
      continue
    }
    if (!inHunk) continue
    if (raw.startsWith('\\')) continue // "\ No newline at end of file"
    position++
    const isAdded = raw.startsWith('+')
    const isContext = raw.startsWith(' ')
    if (!isAdded && !isContext) {
      // "-" line: RIGHT side does not advance
      continue
    }
    if (newLine === targetLine && raw.slice(1) === lineContentAt(fileContent, targetLine)) {
      return { line: targetLine, side: 'RIGHT', position }
    }
    newLine++
  }
  return null
}
