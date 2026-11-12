import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { describe, expect, test } from 'vitest'

// jsdom cannot evaluate print media, so this reads the stylesheet as text (see sheet/sheetPrint.test.ts).
// The real layout is checked with headless Chrome print-to-PDF (one A4 page, only the sheet).
const css = readFileSync(resolve(process.cwd(), 'src/ui/theme.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

function block(src: string, at: string): string {
  const start = src.indexOf(at)
  expect(start).toBeGreaterThan(-1)
  const open = src.indexOf('{', start)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(open + 1, i)
  }
  throw new Error(`unbalanced ${at}`)
}

function ruleFor(src: string, selector: string): string | null {
  for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(',').map(s => s.trim()).includes(selector)) return m[2]
  }
  return null
}

describe('theme.css print rules', () => {
  test('the page is A4 without margins', () => {
    const page = block(css, '@page')
    expect(page).toMatch(/size:\s*A4/)
    expect(page).toMatch(/margin:\s*0/)
  })

  const print = block(css, '@media print')

  test('everything around the sheet is hidden, controls too', () => {
    for (const sel of ['body > :not(#root)', '#root > :not(.app)', '.app > :not(.main)', '.main > :not(.editor)', '.editor > :not(.canvas)', '.canvas > :not(.sheet)', '.controls']) {
      expect(ruleFor(print, sel), sel).toMatch(/display:\s*none\s*!important/)
    }
  })

  test('the sheet prints flat at the top-left', () => {
    expect(ruleFor(print, '.canvas .sheet')).toMatch(/box-shadow:\s*none/)
    const shell = ruleFor(print, '.main')
    expect(shell).toMatch(/padding:\s*0/)
    expect(shell).toMatch(/margin:\s*0/)
  })
})
