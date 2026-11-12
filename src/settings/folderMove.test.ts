import { describe, expect, it } from 'vitest'
import type { Invoice, InvoiceRecord } from '../domain/types'
import { fixtureInvoice } from '../test/fixtures'
import { findMoveConflicts, movableNames, planMove, type Decision } from './folderMove'

const inv = (number: string, dir: string, month = '2026-11', pdf = true): InvoiceRecord => ({
  kind: 'invoice',
  invoice: { ...fixtureInvoice, number } as Invoice,
  jsonPath: `${dir}/${month}_faktura-${number}.json`,
  pdfPath: pdf ? `${dir}/${month}_faktura-${number}.pdf` : null,
  baseName: `${month}_faktura-${number}`,
})
const lone = (fileName: string, dir = '/a'): InvoiceRecord => ({ kind: 'pdfOnly', pdfPath: `${dir}/${fileName}`, fileName })

describe('movableNames', () => {
  it('takes the JSON and the PDF of an invoice, or just the JSON without a PDF', () => {
    expect(movableNames(inv('1', '/a'))).toEqual(['2026-11_faktura-1.json', '2026-11_faktura-1.pdf'])
    expect(movableNames(inv('1', '/a', '2026-11', false))).toEqual(['2026-11_faktura-1.json'])
  })
  it('skips a record with a file name that is not a plain name (a colon would leave the folder on Windows)', () => {
    expect(movableNames(lone('C:_faktura-1.pdf'))).toEqual([])
    expect(movableNames({ ...inv('1', '/a'), pdfPath: '/a/x:y.pdf' })).toEqual([])
  })
  it('takes a lone PDF only when it is a .pdf with the _faktura- naming', () => {
    expect(movableNames(lone('2026-11_faktura-1.pdf'))).toEqual(['2026-11_faktura-1.pdf'])
    expect(movableNames(lone('sken.pdf'))).toEqual([])
    expect(movableNames(lone('_faktura-1.PDF'))).toEqual(['_faktura-1.PDF'])
  })
})

describe('findMoveConflicts', () => {
  it('finds clashes by invoice number, even under other file names', () => {
    const from = [inv('1', '/a'), inv('2', '/a')]
    const to = [inv('1', '/b', '2026-10')]
    const c = findMoveConflicts(from, to)
    expect(c).toHaveLength(1)
    expect(c[0].source).toBe(from[0])
    expect(c[0].existing).toEqual(to)
    expect(planMove(from, [{ conflict: c[0], choice: 'replace' }]).leftovers).toEqual(['/b/2026-10_faktura-1.json', '/b/2026-10_faktura-1.pdf'])
  })
  it('finds clashes by file name against a lone PDF, case-insensitively', () => {
    const c = findMoveConflicts([inv('1', '/a')], [lone('2026-11_FAKTURA-1.pdf', '/b')])
    expect(c).toHaveLength(1)
  })
  it('has no clash without overlap and ignores unmovable lone PDFs', () => {
    expect(findMoveConflicts([inv('1', '/a'), lone('sken.pdf')], [inv('2', '/b'), lone('sken.pdf', '/b')])).toEqual([])
  })
})

describe('planMove', () => {
  const decide = (from: InvoiceRecord[], to: InvoiceRecord[], choices: Decision['choice'][]): Decision[] =>
    findMoveConflicts(from, to).map((conflict, i) => ({ conflict, choice: choices[i] }))

  it('A: never trashes a target file that the move itself writes (two sources with one number, both replace)', () => {
    const from = [inv('5', '/a', '2026-11'), inv('5', '/a', '2026-10')]
    const to = [inv('5', '/b', '2026-10')]
    const p = planMove(from, decide(from, to, ['replace', 'replace']))
    expect(p.names.sort()).toEqual(['2026-10_faktura-5.json', '2026-10_faktura-5.pdf', '2026-11_faktura-5.json', '2026-11_faktura-5.pdf'])
    expect(p.overwrite).toEqual(expect.arrayContaining(['2026-10_faktura-5.json', '2026-10_faktura-5.pdf']))
    expect(p.leftovers).toEqual([])
  })

  it('B: never trashes a target record the user chose to keep, even if another replace matches it', () => {
    const x = { ...inv('6', '/a', '2026-11'), baseName: '2026-11_faktura-5' } as InvoiceRecord // clashes with the target by file name only
    if (x.kind === 'invoice') { x.jsonPath = '/a/2026-11_faktura-5.json'; x.pdfPath = '/a/2026-11_faktura-5.pdf' }
    const y = inv('5', '/a', '2026-10') // clashes with the target by number only
    const target = inv('5', '/b', '2026-11')
    const decisions = findMoveConflicts([x, y], [target])
    expect(decisions).toHaveLength(2)
    const p = planMove([x, y], decisions.map(conflict => ({ conflict, choice: conflict.source === x ? 'keep' : 'replace' })))
    expect(p.names.sort()).toEqual(['2026-10_faktura-5.json', '2026-10_faktura-5.pdf'])
    expect(p.leftovers).toEqual([])
  })

  it('drops the names of a kept record and trashes only real leftovers of a replaced one', () => {
    const from = [inv('1', '/a', '2026-11'), inv('2', '/a', '2026-11')]
    const to = [inv('1', '/b', '2026-10'), inv('2', '/b', '2026-11')]
    const p = planMove(from, decide(from, to, ['replace', 'keep']))
    expect(p.names).toEqual(['2026-11_faktura-1.json', '2026-11_faktura-1.pdf'])
    expect(p.overwrite).toEqual(p.names)
    expect(p.leftovers).toEqual(['/b/2026-10_faktura-1.json', '/b/2026-10_faktura-1.pdf'])
  })
})
