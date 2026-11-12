import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { describe, expect, test } from 'vitest'

// jsdom cannot evaluate print media, so this reads the stylesheet as text (vitest stubs CSS imports, even ?raw).
const css = readFileSync(resolve(process.cwd(), 'src/sheet/sheet.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** Body of the first `@media print { … }` block (brace-matched). */
function printBlock(src: string): string {
  const start = src.indexOf('@media print')
  expect(start).toBeGreaterThan(-1)
  const open = src.indexOf('{', start)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(open + 1, i)
  }
  throw new Error('unbalanced @media print')
}

/** Declarations of the rule in `block` whose selector list contains `selector`. */
function ruleFor(block: string, selector: string): string | null {
  for (const m of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(',').map(s => s.trim()).includes(selector)) return m[2]
  }
  return null
}

describe('sheet.css print rules', () => {
  const print = printBlock(css)

  test('empty-field hints print as a zero-width space, as specific as the screen rule', () => {
    const decl = ruleFor(print, ".sheet[data-mode='edit'] .ed:empty::before")
    expect(decl).not.toBeNull()
    expect(decl).toMatch(/content:\s*'\\200b'/)
    expect(decl).toMatch(/color:\s*inherit/)
  })

  test('edit underline and focus tint are removed in print', () => {
    const decl = ruleFor(print, ".sheet[data-mode='edit'] .ed")
    expect(decl).not.toBeNull()
    expect(decl).toMatch(/text-decoration:\s*none\s*!important/)
    expect(decl).toMatch(/background:\s*none\s*!important/)
    expect(decl).toMatch(/outline:\s*none\s*!important/)
  })
})
