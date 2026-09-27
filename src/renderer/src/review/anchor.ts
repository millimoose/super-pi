/**
 * W3C-style text-quote anchors over plain markdown text. Pure module —
 * fully unit-tested; orphaned anchors surface as "comment outlived its span".
 */

export type SpanAnchor = { exact: string; prefix: string; suffix: string }

export type AnchorRange = { from: number; to: number }

const CONTEXT = 64

export function createAnchor(docText: string, from: number, to: number): SpanAnchor {
  const exact = docText.slice(from, to)
  const prefix = docText.slice(Math.max(0, from - CONTEXT), from)
  const suffix = docText.slice(to, to + CONTEXT)
  return { exact, prefix, suffix }
}

function occurrences(docText: string, needle: string): number[] {
  const found: number[] = []
  let idx = docText.indexOf(needle)
  while (idx !== -1) {
    found.push(idx)
    idx = docText.indexOf(needle, idx + 1)
  }
  return found
}

/**
 * Re-locate an anchor in the current text.
 * Returns 'orphaned' when the span can no longer be located.
 */
export function findAnchor(docText: string, anchor: SpanAnchor): AnchorRange | 'orphaned' {
  if (anchor.exact === '') return 'orphaned'
  let candidates = occurrences(docText, anchor.exact)
  if (candidates.length === 0) return 'orphaned'
  if (candidates.length > 1) {
    const kept = candidates.filter((idx) => {
      const before = docText.slice(Math.max(0, idx - anchor.prefix.length), idx)
      const after = docText.slice(
        idx + anchor.exact.length,
        idx + anchor.exact.length + anchor.suffix.length
      )
      return before === anchor.prefix && after === anchor.suffix
    })
    if (kept.length > 0) candidates = kept
  }
  if (candidates.length !== 1) return 'orphaned'
  const from = candidates[0]
  return { from, to: from + anchor.exact.length }
}
