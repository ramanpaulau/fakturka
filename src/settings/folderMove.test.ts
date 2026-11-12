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
/** An invoice saved by 0.2.1+: `json/` and `pdf/` sub-folders. */
const inv2 = (number: string, dir: string, month = '2026-11'): InvoiceRecord => ({
  kind: 'invoice',
  invoice: { ...fixtureInvoice, number } as Invoice,
  jsonPath: `${dir}/json/${month}_faktura-${number}.json`,
  pdfPath: `${dir}/pdf/${month}_faktura-${number}.pdf`,
  baseName: `${month}_faktura-${number}`,
})

describe('movableNames', () => {
  it('takes the JSON and the PDF of an invoice, or just the JSON without a PDF', () => {
    expect(movableNames(inv('1', '/a'), '/a')).toEqual(['2026-11_faktura-1.json', '2026-11_faktura-1.pdf'])
    expect(movableNames(inv('1', '/a', '2026-11', false), '/a')).toEqual(['2026-11_faktura-1.json'])
  })
  it('skips a record with a file name that is not a plain name (a colon would leave the folder on Windows)', () => {
    expect(movableNames(lone('C:_faktura-1.pdf'), '/a')).toEqual([])
    expect(movableNames({ ...inv('1', '/a'), pdfPath: '/a/x:y.pdf' }, '/a')).toEqual([])
  })
  it('takes a lone PDF only when it is a .pdf with the _faktura- naming', () => {
    expect(movableNames(lone('2026-11_faktura-1.pdf'), '/a')).toEqual(['2026-11_faktura-1.pdf'])
    expect(movableNames(lone('sken.pdf'), '/a')).toEqual([])
    expect(movableNames(lone('_faktura-1.PDF'), '/a')).toEqual(['_faktura-1.PDF'])
  })
})

describe('findMoveConflicts', () => {
  it('finds clashes by invoice number, even under other file names', () => {
    const from = [inv('1', '/a'), inv('2', '/a')]
    const to = [inv('1', '/b', '2026-10')]
    const c = findMoveConflicts(from, to, '/a')
    expect(c).toHaveLength(1)
    expect(c[0].source).toBe(from[0])
    expect(c[0].existing).toEqual(to)
    expect(planMove(from, [{ conflict: c[0], choice: 'replace' }], '/a', '/b').leftovers).toEqual(['/b/2026-10_faktura-1.json', '/b/2026-10_faktura-1.pdf'])
  })
  it('finds clashes by file name against a lone PDF, case-insensitively', () => {
    const c = findMoveConflicts([inv('1', '/a')], [lone('2026-11_FAKTURA-1.pdf', '/b')], '/a')
    expect(c).toHaveLength(1)
  })
  it('has no clash without overlap and ignores unmovable lone PDFs', () => {
    expect(findMoveConflicts([inv('1', '/a'), lone('sken.pdf')], [inv('2', '/b'), lone('sken.pdf', '/b')], '/a')).toEqual([])
  })
})

describe('planMove', () => {
  const decide = (from: InvoiceRecord[], to: InvoiceRecord[], choices: Decision['choice'][]): Decision[] =>
    findMoveConflicts(from, to, '/a').map((conflict, i) => ({ conflict, choice: choices[i] }))

  it('A: never trashes a target file that the move itself writes (two sources with one number, both replace)', () => {
    const from = [inv('5', '/a', '2026-11'), inv('5', '/a', '2026-10')]
    const to = [inv('5', '/b', '2026-10')]
    const p = planMove(from, decide(from, to, ['replace', 'replace']), '/a', '/b')
    expect(p.names.sort()).toEqual(['2026-10_faktura-5.json', '2026-10_faktura-5.pdf', '2026-11_faktura-5.json', '2026-11_faktura-5.pdf'])
    expect(p.overwrite).toEqual(expect.arrayContaining(['2026-10_faktura-5.json', '2026-10_faktura-5.pdf']))
    expect(p.leftovers).toEqual([])
  })

  it('B: never trashes a target record the user chose to keep, even if another replace matches it', () => {
    const x = { ...inv('6', '/a', '2026-11'), baseName: '2026-11_faktura-5' } as InvoiceRecord // clashes with the target by file name only
    if (x.kind === 'invoice') { x.jsonPath = '/a/2026-11_faktura-5.json'; x.pdfPath = '/a/2026-11_faktura-5.pdf' }
    const y = inv('5', '/a', '2026-10') // clashes with the target by number only
    const target = inv('5', '/b', '2026-11')
    const decisions = findMoveConflicts([x, y], [target], '/a')
    expect(decisions).toHaveLength(2)
    const p = planMove([x, y], decisions.map(conflict => ({ conflict, choice: conflict.source === x ? 'keep' : 'replace' })), '/a', '/b')
    expect(p.names.sort()).toEqual(['2026-10_faktura-5.json', '2026-10_faktura-5.pdf'])
    expect(p.leftovers).toEqual([])
  })

  it('drops the names of a kept record and trashes only real leftovers of a replaced one', () => {
    const from = [inv('1', '/a', '2026-11'), inv('2', '/a', '2026-11')]
    const to = [inv('1', '/b', '2026-10'), inv('2', '/b', '2026-11')]
    const p = planMove(from, decide(from, to, ['replace', 'keep']), '/a', '/b')
    expect(p.names).toEqual(['2026-11_faktura-1.json', '2026-11_faktura-1.pdf'])
    expect(p.overwrite).toEqual(p.names)
    expect(p.leftovers).toEqual(['/b/2026-10_faktura-1.json', '/b/2026-10_faktura-1.pdf'])
  })
})

describe('folder move with the pdf/ and json/ sub-folders', () => {
  it('names files relative to the folder: sub-folder files with their prefix, legacy files plain, older copies included', () => {
    expect(movableNames(inv2('1', '/a'), '/a')).toEqual(['json/2026-11_faktura-1.json', 'pdf/2026-11_faktura-1.pdf'])
    const both = { ...inv2('1', '/a'), extraPaths: ['/a/2026-11_faktura-1.json', '/a/2026-11_faktura-1.pdf'] }
    expect(movableNames(both, '/a')).toEqual(['json/2026-11_faktura-1.json', 'pdf/2026-11_faktura-1.pdf', '2026-11_faktura-1.json', '2026-11_faktura-1.pdf'])
    expect(movableNames(lone('2026-11_faktura-9.pdf'), '/a/')).toEqual(['2026-11_faktura-9.pdf'])
    expect(movableNames({ kind: 'pdfOnly', pdfPath: '/a/pdf/2026-11_faktura-9.pdf', fileName: '2026-11_faktura-9.pdf' }, '/a')).toEqual(['pdf/2026-11_faktura-9.pdf'])
  })
  it('works with Windows paths', () => {
    const r: InvoiceRecord = { ...(inv2('1', 'C:\\F') as Extract<InvoiceRecord, { kind: 'invoice' }>), jsonPath: 'C:\\F\\json\\2026-11_faktura-1.json', pdfPath: 'C:\\F\\2026-11_faktura-1.pdf' }
    expect(movableNames(r, 'C:\\F')).toEqual(['json/2026-11_faktura-1.json', '2026-11_faktura-1.pdf'])
  })
  it('leaves a record put when a file is not directly in the folder or one of its two sub-folders', () => {
    expect(movableNames({ ...inv2('1', '/a'), pdfPath: '/a/other/2026-11_faktura-1.pdf' }, '/a')).toEqual([])
    expect(movableNames(inv2('1', '/elsewhere'), '/a')).toEqual([])
  })
  it('a new-layout source clashing with a legacy target by file name replaces it and trashes the legacy files', () => {
    const from = [inv2('1', '/a')]
    const to = [inv('1', '/b')]
    const c = findMoveConflicts(from, to, '/a')
    expect(c).toHaveLength(1)
    const p = planMove(from, [{ conflict: c[0], choice: 'replace' }], '/a', '/b')
    expect(p.names).toEqual(['json/2026-11_faktura-1.json', 'pdf/2026-11_faktura-1.pdf'])
    expect(p.overwrite).toEqual(p.names)
    expect(p.leftovers).toEqual(['/b/2026-11_faktura-1.json', '/b/2026-11_faktura-1.pdf'])
  })
  it('a legacy source replacing a new-layout target trashes the target sub-folder files', () => {
    const from = [inv('1', '/a')]
    const to = [inv2('1', '/b')]
    const p = planMove(from, findMoveConflicts(from, to, '/a').map(conflict => ({ conflict, choice: 'replace' as const })), '/a', '/b')
    expect(p.names).toEqual(['2026-11_faktura-1.json', '2026-11_faktura-1.pdf'])
    expect(p.leftovers).toEqual(['/b/json/2026-11_faktura-1.json', '/b/pdf/2026-11_faktura-1.pdf'])
  })
  it('the same relative path is overwritten, not trashed', () => {
    const from = [inv2('1', '/a')]
    const to = [inv2('1', '/b')]
    const p = planMove(from, findMoveConflicts(from, to, '/a').map(conflict => ({ conflict, choice: 'replace' as const })), '/a', '/b')
    expect(p.overwrite).toEqual(['json/2026-11_faktura-1.json', 'pdf/2026-11_faktura-1.pdf'])
    expect(p.leftovers).toEqual([])
  })
})
