import { INNER } from '../sheet/layout'

/**
 * Greedy word wrap. Breaks only at regular spaces (non-breaking spaces keep amounts together),
 * honours '\n', and splits a word that is wider than `maxWidth` by character.
 */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    const words = para.split(' ').filter(Boolean)
    let line = ''
    for (let word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (measure(candidate) <= maxWidth) {
        line = candidate
        continue
      }
      if (line) out.push(line)
      while (word.length > 1 && measure(word) > maxWidth) {
        let n = 1
        while (n < word.length - 1 && measure(word.slice(0, n + 1)) <= maxWidth) n++
        out.push(word.slice(0, n))
        word = word.slice(n)
      }
      line = word
    }
    out.push(line)
  }
  return out
}

/** The shrink rule shared by the sheet and the PDF: largest size from `base` down in 0.5 pt steps that fits, at least 7 pt. */
export function shrinkToFit(base: number, fits: (size: number) => boolean, min = INNER.minFontSize, step = INNER.fontStep): number {
  let size = base
  while (size - step >= min - 1e-9 && !fits(size)) size -= step
  return size
}

export type Para = { text: string; bold?: boolean }
export type Line = { text: string; bold: boolean }
/** Width of `s` in mm at `size` pt. */
export type Measure = (s: string, size: number, bold: boolean) => number

/**
 * Wraps the paragraphs to `width` (mm) and shrinks them until they fit `height` (mm).
 * At the minimum size the lines are clamped to what fits, like CSS overflow clipping.
 */
export function fitParagraphs(
  paras: Para[],
  width: number,
  height: number,
  measure: Measure,
  opts: { base: number; lineHeight: number },
): { size: number; lines: Line[] } {
  const lineMm = (size: number) => (size * opts.lineHeight * 25.4) / 72
  const wrap = (size: number): Line[] =>
    paras.flatMap((p) => wrapText(p.text, width, (s) => measure(s, size, !!p.bold)).map((text) => ({ text, bold: !!p.bold })))
  const size = shrinkToFit(opts.base, (s) => wrap(s).length * lineMm(s) <= height + 1e-9)
  const max = Math.max(1, Math.floor((height + 1e-9) / lineMm(size)))
  return { size, lines: wrap(size).slice(0, max) }
}
